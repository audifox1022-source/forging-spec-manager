"use client"; // <-- 이 줄은 유지되어야 합니다.
import { useState, useEffect, useCallback, useMemo } from 'react'; // FIX: React 제거
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, onSnapshot, addDoc, doc, deleteDoc, orderBy, serverTimestamp } from 'firebase/firestore';
import { Search, FileText, Download, Upload, Trash2, Loader2, XCircle, Zap, File, ListChecks, AlertTriangle } from 'lucide-react';

// --- Configuration Helper ---
// 환경 변수나 전역 변수에서 안전하게 값을 가져오는 함수
const getConfig = () => {
    let fbConfig = {};
    let gApiKey = "";
    let isVercel = false;

    // 1. Check Next.js / StackBlitz / Vercel Environment Variables
    if (typeof process !== 'undefined') {
        if (process.env.NEXT_PUBLIC_FIREBASE_CONFIG) {
            isVercel = true;
            try {
                const envConfig = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;
                fbConfig = typeof envConfig === 'string' ? JSON.parse(envConfig) : envConfig;
            } catch (e) {
                console.error("Failed to parse NEXT_PUBLIC_FIREBASE_CONFIG:", e);
                fbConfig = {}; 
            }
        }
        if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
            gApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        }
    }

    // 2. Canvas/Internal Environment Check (Fallback/Primary in Canvas)
    if (typeof __firebase_config !== 'undefined' && !isVercel) {
        try {
            fbConfig = JSON.parse(__firebase_config);
        } catch (e) {
            console.error("Failed to parse __firebase_config:", e);
        }
    }
    
    // FIX 1: If apiKey is missing in the parsed Firebase config, use Gemini key if available
    if (!fbConfig.apiKey && gApiKey) {
        fbConfig.apiKey = gApiKey; 
        console.warn("Firebase apiKey was derived from Gemini API Key for initialization.");
    }
    
    // FIX 2: If projectId is missing, use the default app ID for stability
    const fallbackProjectId = 'canvas-project-' + (Math.random().toString(36).substring(2, 8));
    if (!fbConfig.projectId) {
        fbConfig.projectId = fallbackProjectId;
        console.warn("Firebase projectId was set to a default value for initialization.");
    }
    if (!fbConfig.storageBucket) {
        fbConfig.storageBucket = `${fbConfig.projectId}.appspot.com`;
    }


    return { fbConfig, gApiKey, isVercel };
};

const { fbConfig: firebaseConfig, gApiKey: envApiKey, isVercel } = getConfig();

// FIX: Sanitize the appId to prevent Firestore path errors caused by slashes in the environment variable.
const sanitizeAppId = (id) => {
    if (typeof id === 'string') {
        return id.replace(/\//g, '-').replace(/\./g, '_');
    }
    return 'spec-manager-v1';
};

// --- Global Variables ---
let dynamicAppId = 'spec-manager-v1';
if (typeof __app_id !== 'undefined') {
    dynamicAppId = sanitizeAppId(__app_id);
} else if (isVercel && typeof process !== 'undefined' && process.env.NEXT_PUBLIC_VERCEL_PROJECT_ID) {
    dynamicAppId = sanitizeAppId(process.env.NEXT_PUBLIC_VERCEL_PROJECT_ID);
}
const appId = dynamicAppId;

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null; 
const apiKey = envApiKey || ""; 

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

// Helper function for exponential backoff retry
const fetchWithRetry = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            if (response.status === 429 && i < retries - 1) { // Rate limit
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        } catch (error) {
            if (i === retries - 1) throw error;
        }
    }
};

// --- Firebase Initialization and Auth Logic ---
let app, db, auth;
let globalInitError = null; // Renamed to clearly differentiate from local state

try {
    // Check if config is valid (has apiKey at minimum)
    if (firebaseConfig && firebaseConfig.apiKey) {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
    } else {
        // Collect error message if config is missing
        globalInitError = "Firebase Configuration (apiKey, projectId, etc.)이 누락되었습니다.";
        console.warn(globalInitError);
    }
} catch (e) {
    console.error("Firebase initialization failed:", e);
    globalInitError = e.message;
}

// Data Structure: /artifacts/{appId}/users/{userId}/forging_specs/{docId}

const ForgingSpecManager = () => {
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [userId, setUserId] = useState(null);
    const [specs, setSpecs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false); // Global loading for data fetching/saving
    const [modal, setModal] = useState({ isOpen: false, type: '', data: null });
    const [error, setError] = useState('');

    // 1. Firebase Authentication & Initialization
    useEffect(() => {
        if (!auth) {
            return; // Initialization failed globally
        }

        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                setUserId(user.uid);
            } else if (initialAuthToken) {
                try {
                    await signInWithCustomToken(auth, initialAuthToken);
                } catch (e) {
                    console.error("Custom token sign-in failed. Falling back to anonymous.", e);
                    await signInAnonymously(auth);
                }
            } else {
                await signInAnonymously(auth);
            }
            setIsAuthReady(true);
        });
        return () => unsubscribe();
    }, []);

    // 2. Firestore Real-time Data Fetching
    useEffect(() => {
        if (!isAuthReady || !userId || !db) return;
        
        // Define collection path for private data
        const specCollectionPath = `artifacts/${appId}/users/${userId}/forging_specs`;
        
        let unsubscribe;
        try {
            const q = query(collection(db, specCollectionPath), orderBy('createdAt', 'desc'));
            console.log(`Firestore Listener attached for path: ${specCollectionPath}`);
            
            unsubscribe = onSnapshot(q, (snapshot) => {
                const fetchedSpecs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setSpecs(fetchedSpecs);
                if (error) setError(''); // Clear error if data is fetched successfully
            }, (e) => {
                console.error("Firestore data fetch failed:", e);
                if (e.code !== 'permission-denied') {
                    setError("데이터 로딩 중 오류가 발생했습니다. (연결 문제 등)");
                }
            });
        } catch (e) {
            console.error("Firestore query creation failed:", e);
        }

        return () => { if (unsubscribe) unsubscribe(); };
    }, [isAuthReady, userId]);

    // --- Gemini API Handler: Generate Summary & Keywords ---
    const generateSpecMetadata = useCallback(async (fileName, fileContent) => {
        // API Key Check for Manual Environments
        if (!apiKey && !process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
            throw new Error("Gemini API Key가 설정되지 않았습니다. .env.local 파일을 확인해주세요.");
        }

        const systemPrompt = `당신은 전문적인 '단조 시방서' 분석 전문가입니다. 사용자가 제공한 문서 내용을 바탕으로 핵심 요약(summary)과 주요 키워드(keywords)를 추출하여 JSON 형식으로 제공하십시오.
        핵심 요약은 50단어 이내로, 키워드는 5개 이내의 배열로 작성하십시오.`;

        const userQuery = `문서 제목: ${fileName}. 문서 내용 (가상): ${fileContent}`;

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "summary": { "type": "STRING", "description": "50단어 이내의 문서 핵심 요약." },
                        "keywords": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "문서의 주요 키워드 (5개 이내)." }
                    },
                    required: ["summary", "keywords"]
                }
            }
        };

        try {
            const response = await fetchWithRetry(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!jsonText) throw new Error("API 응답에서 내용이 누락되었습니다.");

            const parsedData = JSON.parse(jsonText);
            
            return {
                summary: parsedData.summary || "요약 생성 실패",
                keywords: Array.isArray(parsedData.keywords) ? parsedData.keywords : []
            };

        } catch (e) {
            console.error(`Gemini API 또는 JSON 파싱 오류 (문서: ${fileName}):`, e);
            throw new Error(`AI 분석 실패: ${e.message}`);
        }
    }, []);

    // --- CRUD Operations ---

    // Spec Registration (Handles saving of PRE-ANALYZED specs)
    const handleSaveAnalyzedSpecs = async (specsToSave) => {
        if (!userId || !db) {
            setError("인증 또는 데이터베이스 연결이 준비되지 않았습니다.");
            return;
        }

        setLoading(true); // Global loading for saving process
        let saveError = '';
        
        const specCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/forging_specs`);
        
        const savePromises = specsToSave
            .filter(spec => spec.status === 'analyzed') // Only save successfully analyzed items
            .map(async (spec) => {
            
            try {
                await addDoc(specCollectionRef, {
                    fileName: spec.fileName,
                    fileType: spec.fileType,
                    downloadLink: `#mock-link-${Math.random().toString(36).substring(7)}`, // Mock link
                    summary: spec.summary,
                    keywords: spec.keywords,
                    userId, // For security rule context
                    createdAt: serverTimestamp(),
                });
            } catch (e) {
                console.error(`Firestore 문서 추가 실패 (문서: ${spec.fileName}):`, e);
                saveError = saveError + `\n[${spec.fileName}] 저장 실패: ${e.message}`;
            }
        });

        await Promise.all(savePromises);
        
        setLoading(false); // End global loading
        setModal({ isOpen: false, type: '', data: null });
        if (saveError) {
             setError("일부 문서 저장에 실패했습니다. 콘솔을 확인하세요." + saveError);
        }
    };

    // Spec Deletion (Unchanged)
    const handleDeleteSpec = async (id) => {
        if (!userId || !db) {
            setError("인증 또는 데이터베이스 연결이 준비되지 않았습니다.");
            return;
        }
        try {
            const docRef = doc(db, `artifacts/${appId}/users/${userId}/forging_specs`, id);
            await deleteDoc(docRef);
        } catch (e) {
            console.error("Firestore 문서 삭제 실패:", e);
            setError(`문서 삭제 실패: ${e.message}`);
        }
    };

    // --- UI/Filtering Logic (Unchanged) ---
    const filteredSpecs = useMemo(() => {
        if (!searchTerm) return specs;
        const lowerCaseSearch = searchTerm.toLowerCase();

        return specs.filter(spec =>
            spec.fileName.toLowerCase().includes(lowerCaseSearch) ||
            spec.keywords?.some(keyword => keyword.toLowerCase().includes(lowerCaseSearch)) ||
            spec.summary?.toLowerCase().includes(lowerCaseSearch)
        );
    }, [specs, searchTerm]);

    // --- Configuration Guard UI ---
    // Use the globalInitError check here.
    if (globalInitError || !auth) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center border border-red-100">
                    <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">설정 오류 발생</h2>
                    <p className="text-gray-600 mb-6">
                        앱을 실행하기 위한 Firebase 및 AI 설정이 감지되지 않았습니다.<br/>
                        <span className="text-sm text-gray-400 block mt-2">({globalInitError || "Initialization Failed"})</span>
                    </p>
                    <div className="text-left bg-gray-100 p-4 rounded text-sm text-gray-700 overflow-x-auto">
                        <p className="font-semibold mb-1">StackBlitz/Vercel 해결 방법:</p>
                        <ol className="list-decimal list-inside space-y-1">
                            <li>Vercel의 **환경 변수**에 아래 두 항목을 **NEXT_PUBLIC_** 접두사와 함께 등록했는지 확인하세요.</li>
                            <li>특히 <code>NEXT_PUBLIC_FIREBASE_CONFIG</code>는 **JSON 문자열 전체**로 입력해야 합니다. (<code>projectId</code>, <code>apiKey</code> 등 필수)</li>
                        </ol>
                        <pre className="bg-gray-800 text-white p-2 rounded mt-2 text-xs overflow-x-auto">
                            NEXT_PUBLIC_GEMINI_API_KEY="AIza..."{'\n'}
                            NEXT_PUBLIC_FIREBASE_CONFIG={JSON.stringify({ apiKey: "...", projectId: "...", appId: "..." })}
                        </pre>
                    </div>
                </div>
            </div>
        );
    }

    // --- Components ---
    
    // Component for a single upload item
    const UploadItem = ({ index, item, onChange, onDelete, onAnalyze, isAnalyzing }) => {
        // fileType extraction based on extension
        const getFileTypeFromExtension = (name) => {
            const ext = name.split('.').pop().toLowerCase();
            if (['pdf'].includes(ext)) return 'PDF';
            if (['xlsx', 'xls'].includes(ext)) return 'XLSX';
            if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP';
            return 'ETC';
        };

        const isReadyForAnalysis = item.fileName; // Only file selection is mandatory now
        const isAnalyzed = item.status === 'analyzed';
        const isError = item.status === 'error';
        const isCurrentAnalyzing = item.status === 'analyzing';

        // Display logic for file name
        const displayFileName = item.filePath ? `${item.filePath}/${item.fileName}` : item.fileName;

        return (
            <div className={`bg-gray-100 p-4 rounded-lg border-2 ${isAnalyzed ? 'border-green-400' : isError ? 'border-red-400' : 'border-gray-200'} shadow-inner mb-4 transition duration-300`}>
                <div className="flex justify-between items-start mb-2">
                    <h4 className="font-semibold text-gray-700">문서 #{index + 1}</h4>
                    {index > 0 && (
                        <button
                            type="button"
                            onClick={() => onDelete(item.id)} // Pass ID instead of index for consistency
                            className="text-red-500 hover:text-red-700 transition"
                            title="항목 제거"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
                <div className="space-y-3">
                    {/* Display File Name (Read-only) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">선택된 파일 경로 및 이름</label>
                        <div className="mt-1 flex items-center bg-white p-2 rounded-lg border border-gray-300 shadow-sm text-gray-800">
                            <File size={16} className="mr-2 text-indigo-500" />
                            <span className='truncate'>{displayFileName || "파일을 선택해주세요."}</span>
                            <span className="ml-auto font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-xs">
                                {item.fileName ? getFileTypeFromExtension(item.fileName) : 'N/A'}
                            </span>
                        </div>
                        {item.fileName && (
                           <p className="text-xs text-gray-500 mt-1">파일 유형은 확장자를 기반으로 자동 분류되었습니다. (폴더 경로 포함)</p>
                        )}
                    </div>

                    {/* Mock Content Input - Optional */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700">AI 분석용 핵심 정보 (선택 사항)</label>
                        <textarea
                            value={item.mockContent}
                            onChange={(e) => onChange(item.id, 'mockContent', e.target.value)}
                            placeholder="문서의 주요 재질, 규격, 핵심 내용 등을 입력하면 더 정확하게 분석됩니다. (비워두면 파일명 기반으로 분석 추론)"
                            rows="3"
                            className="mt-1 block w-full rounded-lg border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                            disabled={isCurrentAnalyzing || !item.fileName}
                        />
                        {!item.fileName && (
                            <p className="text-xs text-red-500 mt-1">파일을 먼저 선택해야 내용을 입력할 수 있습니다.</p>
                        )}
                    </div>
                </div>
                
                {/* Analysis Status and Button */}
                <div className="mt-4 border-t pt-3 border-gray-200">
                    {isAnalyzed && (
                        <div className="bg-green-50 text-green-700 p-2 rounded-lg text-sm mb-2">
                            <span className="font-bold">분석 완료:</span> {item.summary}
                        </div>
                    )}
                    {isError && (
                        <div className="bg-red-50 text-red-700 p-2 rounded-lg text-sm mb-2">
                            <span className="font-bold">분석 오류:</span> {item.error}
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => onAnalyze(item.id, item)}
                        disabled={!isReadyForAnalysis || isCurrentAnalyzing || isAnalyzing}
                        className={`w-full flex justify-center items-center py-2 px-4 rounded-lg shadow-sm text-sm font-medium transition ${
                            isCurrentAnalyzing ? 'bg-yellow-500 text-white' : 
                            isAnalyzed ? 'bg-green-600 text-white hover:bg-green-700' :
                            isReadyForAnalysis ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 
                            'bg-gray-400 text-gray-200'
                        }`}
                    >
                        {isCurrentAnalyzing ? (
                            <>
                                <Loader2 size={16} className="animate-spin mr-2" />
                                AI 분석 중...
                            </>
                        ) : isAnalyzed ? (
                            <>
                                <Zap size={16} className="mr-2" />
                                재분석 (분석 완료됨)
                            </>
                        ) : (
                            <>
                                <Zap size={16} className="mr-2" />
                                분석하기 (AI 요약 생성)
                            </>
                        )}
                    </button>
                </div>
            </div>
        );
    };


    const SpecCard = ({ spec }) => (
        // ... (SpecCard component remains unchanged) ...
        <div className="bg-white p-4 rounded-xl shadow-lg hover:shadow-xl transition duration-300 flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-3 sm:space-y-0 sm:space-x-4 border border-gray-100">
            <div className="flex-grow">
                <p className="text-lg font-semibold text-gray-800 break-words">{spec.fileName}</p>
                <div className="text-sm text-gray-500 mt-1 flex items-center flex-wrap">
                    <span className="font-medium mr-2 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600">{spec.fileType}</span>
                    <span className='mr-2'>|</span>
                    {spec.keywords && spec.keywords.map((k, i) => (
                        <span key={i} className="text-xs mr-1 bg-gray-100 text-gray-600 rounded-md px-1.5 py-0.5 mt-1 sm:mt-0">{k}</span>
                    ))}
                    {!spec.keywords || spec.keywords.length === 0 && <span className="text-xs italic">키워드 없음</span>}
                </div>
            </div>
            <div className="flex space-x-2 flex-shrink-0 w-full sm:w-auto">
                <button
                    onClick={() => setModal({ isOpen: true, type: 'preview', data: spec })}
                    className="flex items-center justify-center p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition shadow-md w-1/3 sm:w-auto"
                    title="미리보기"
                >
                    <FileText size={18} />
                </button>
                <a
                    href={spec.downloadLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                        e.preventDefault();
                        setModal({ isOpen: true, type: 'info', data: "다운로드 기능: 이 앱은 메타데이터만 관리합니다. 실제 파일은 '다운로드 링크'를 통해 접근해야 합니다." });
                    }}
                    className="flex items-center justify-center p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition shadow-md w-1/3 sm:w-auto"
                    title="다운로드"
                >
                    <Download size={18} />
                </a>
                <button
                    onClick={() => handleDeleteSpec(spec.id)}
                    className="flex items-center justify-center p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition shadow-md w-1/3 sm:w-auto"
                    title="삭제"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );

    const SpecUploadModal = () => {
        const initialItem = { 
            id: null, // Unique ID derived from file name or index
            fileName: '', 
            filePath: '', // New field for folder path
            fileType: '', // Derived from extension
            mockContent: '', 
            status: 'pending', // 'pending' | 'analyzing' | 'analyzed' | 'error'
            summary: '', 
            keywords: [], 
            error: '' 
        };
        const [uploadQueue, setUploadQueue] = useState([]); // Start with empty queue
        const [isAnalyzing, setIsAnalyzing] = useState(false); // Local state for analysis
        
        const analyzedCount = uploadQueue.filter(item => item.status === 'analyzed').length;
        const canSave = analyzedCount > 0;

        const handleFileSelect = (event) => {
            const files = Array.from(event.target.files);
            if (files.length === 0) return;

            const newSpecs = files.map(file => {
                const parts = file.name.split('.');
                const fileType = parts.length > 1 ? parts.pop().toUpperCase() : 'N/A';
                
                // Determine file path for folder upload
                let filePath = '';
                // 'webkitRelativePath' is available on Chrome/Edge for folder uploads
                if (file.webkitRelativePath) {
                    const pathParts = file.webkitRelativePath.split('/');
                    // The actual file name is the last part, the path is everything before it.
                    filePath = pathParts.slice(0, -1).join('/'); 
                }
                
                return {
                    ...initialItem,
                    // FIX: Use crypto.randomUUID() for guaranteed unique ID
                    id: crypto.randomUUID(), 
                    fileName: file.name,
                    filePath: filePath, 
                    fileType: fileType, // Simplified type extraction
                };
            });
            
            // Append new files to existing queue
            setUploadQueue(prev => {
                // Use a combination of path and name for uniqueness check
                const currentIdentifiers = new Set(prev.map(item => item.filePath + item.fileName));
                const uniqueNewSpecs = newSpecs.filter(spec => !currentIdentifiers.has(spec.filePath + spec.fileName));
                return [...prev, ...uniqueNewSpecs];
            });

            // Clear file input value to allow selecting the same file again
            event.target.value = ''; 
        };

        const handleRemoveItem = (id) => {
            setUploadQueue(uploadQueue.filter((item) => item.id !== id));
        };

        const handleInputChange = (id, field, value) => {
            const newQueue = uploadQueue.map((item) => {
                if (item.id === id) {
                    // Reset status to pending if input is changed after analysis
                    return { 
                        ...item, 
                        [field]: value, 
                        status: 'pending',
                        summary: '',
                        keywords: [],
                        error: ''
                    };
                }
                return item;
            });
            setUploadQueue(newQueue);
        };
        
        // --- Core Analysis Worker (Used by both individual and batch analysis) ---
        const analyzeAndSetQueue = async (id, item) => {
            // Set status to analyzing for the specific item
            setUploadQueue(prev => prev.map((q) => q.id === id ? { ...q, status: 'analyzing', error: '' } : q));
            
            try {
                // --- Core Analysis Logic ---
                let contentToAnalyze = item.mockContent;
                if (!contentToAnalyze) {
                    // Use filename and file path in the fallback prompt
                    const fullIdentifier = item.filePath ? `${item.filePath}/${item.fileName}` : item.fileName;
                    contentToAnalyze = `이 문서는 "${fullIdentifier}"이라는 전체 이름의 ${item.fileType} 형식 시방서입니다. 이 문서가 일반적인 단조 프로젝트의 기술 요구 사항, 재료 사양, 테스트 절차 및 공차 한계를 상세히 다루고 있다고 가정하고, 파일 경로/제목과 문서 유형을 기반으로 요약 및 키워드를 생성하십시오.`;
                }

                const { summary, keywords } = await generateSpecMetadata(item.fileName, contentToAnalyze);

                // Update state with success results
                setUploadQueue(prev => prev.map((q) => 
                    q.id === id ? { 
                        ...q, 
                        summary, 
                        keywords, 
                        status: 'analyzed' 
                    } : q
                ));
            } catch (e) {
                console.error(`분석 오류 (문서: ${item.fileName})`, e);
                // Update state with error status
                setUploadQueue(prev => prev.map((q) => 
                    q.id === id ? { 
                        ...q, 
                        status: 'error', 
                        error: e.message 
                    } : q
                ));
            }
        };

        const handleAnalyzeItem = (id, item) => {
            if (!item.fileName) {
                alert("파일을 먼저 선택해야 분석할 수 있습니다.");
                return;
            }
            // Individual analysis uses the global lock, but calls the core worker
            setIsAnalyzing(true); 
            analyzeAndSetQueue(id, item).finally(() => setIsAnalyzing(false));
        };
        
        // --- NEW: Batch Analysis Function ---
        const handleAnalyzeAll = async () => {
            const itemsToAnalyze = uploadQueue.filter(item => item.fileName && (item.status === 'pending' || item.status === 'error'));
            
            if (itemsToAnalyze.length === 0) {
                alert("분석할 대기 중이거나 오류가 발생한 항목이 없습니다.");
                return;
            }

            // Set global lock for batch process
            setIsAnalyzing(true);
            
            // Create an array of promises for concurrent analysis
            const analysisPromises = itemsToAnalyze.map(item => analyzeAndSetQueue(item.id, item));

            // Wait for all analyses to complete
            await Promise.all(analysisPromises);
            
            // Reset global lock
            setIsAnalyzing(false);
        };
        // --- End NEW Batch Analysis Function ---


        const handleSave = async (e) => {
            e.preventDefault();
            const specsToSave = uploadQueue.filter(item => item.status === 'analyzed');
            
            if (specsToSave.length === 0) {
                alert("저장할 분석 완료 항목이 없습니다. '분석하기' 버튼을 먼저 눌러주세요.");
                return;
            }
            
            await handleSaveAnalyzedSpecs(specsToSave);
            // Closing modal is handled inside handleSaveAnalyyzedSpecs on success/completion
        };

        return (
            <div className="p-6 max-h-[80vh] overflow-y-auto">
                <h3 className="text-2xl font-bold text-gray-800 mb-4">시방서 등록 및 AI 분석</h3>
                <p className="text-sm text-gray-600 mb-6">
                    **파일 또는 폴더를 선택**하여 목록에 추가합니다. 각 항목에 **AI 분석용 핵심 정보**를 입력(선택 사항) 후 **'분석하기'**를 눌러 AI 요약과 키워드를 생성하고, **'저장하기'**를 통해 최종 등록하세요.
                </p>
                
                {/* File Selection Input */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">PC에서 시방서 파일 또는 폴더 선택</label>
                    <label className="flex items-center justify-center w-full py-3 px-4 border-2 border-dashed border-indigo-300 rounded-lg shadow-sm text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition cursor-pointer">
                        <Upload size={20} className="mr-3" />
                        <span className="font-semibold">파일 또는 폴더를 선택하여 목록에 추가</span>
                        <input
                            type="file"
                            multiple
                            webkitdirectory="true" // Enable folder selection
                            directory=""            // Fallback attribute
                            onChange={handleFileSelect}
                            className="hidden"
                            accept=".pdf, .xlsx, .xls, .zip, .rar, .7z"
                        />
                    </label>
                    {/* Updated Guidance Text */}
                    <p className="text-xs text-gray-500 mt-2">
                        **💡 다중 폴더 등록 안내:** 폴더 선택 시 한 번에 하나의 폴더만 지정할 수 있습니다. 여러 폴더의 파일을 등록하려면 **폴더 선택을 반복**하거나, **여러 파일을 한 번에 선택**하십시오. 파일들은 목록에 누적됩니다.
                    </p>
                    {uploadQueue.length > 0 && (
                        <p className="text-sm text-gray-500 mt-2">총 {uploadQueue.length}개의 파일이 목록에 준비되었습니다.</p>
                    )}
                </div>

                {/* NEW: Analyze All Button */}
                {uploadQueue.length > 0 && (
                    <div className="mb-6 border-b pb-4">
                        <button
                            type="button"
                            onClick={handleAnalyzeAll}
                            disabled={isAnalyzing || analyzedCount === uploadQueue.length}
                            className={`w-full flex justify-center items-center py-3 px-6 rounded-lg shadow-md font-bold transition ${
                                isAnalyzing ? 'bg-yellow-500 text-white' : 
                                analyzedCount === uploadQueue.length ? 'bg-gray-400 text-gray-200' : 
                                'bg-purple-600 text-white hover:bg-purple-700'
                            }`}
                        >
                            {isAnalyzing ? (
                                <>
                                    <Loader2 size={18} className="animate-spin mr-3" />
                                    전체 항목 AI 분석 중... ({uploadQueue.length - analyzedCount}개 남음)
                                </>
                            ) : analyzedCount === uploadQueue.length ? (
                                <>
                                    <ListChecks size={18} className="mr-3" />
                                    모든 항목 분석 완료!
                                </>
                            ) : (
                                <>
                                    <Zap size={18} className="mr-3" />
                                    일괄 분석하기 ({uploadQueue.length - analyzedCount}개 대기)
                                </>
                            )}
                        </button>
                    </div>
                )}


                <form onSubmit={handleSave} className="space-y-4">
                    {uploadQueue.length === 0 ? (
                        <div className="text-center py-8 text-gray-500 border border-dashed border-gray-300 rounded-lg">
                            <p className="font-medium">👆 상단 버튼을 눌러 시방서 파일 또는 폴더를 선택해주세요.</p>
                        </div>
                    ) : (
                        uploadQueue.map((item, index) => (
                            <UploadItem
                                key={item.id}
                                index={index}
                                item={item}
                                onChange={handleInputChange}
                                onDelete={handleRemoveItem}
                                onAnalyze={handleAnalyzeItem}
                                isAnalyzing={isAnalyzing} // Pass the global state
                            />
                        ))
                    )}
                    

                    <button
                        type="submit"
                        disabled={!canSave || loading || isAnalyzing}
                        className="w-full flex justify-center items-center py-3 px-6 border border-transparent rounded-lg shadow-xl text-lg font-bold text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400 transition mt-6"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={18} className="animate-spin mr-3" />
                                항목 저장 중...
                            </>
                        ) : (
                            <>
                                <Download size={18} className="mr-3" />
                                분석 완료 항목 저장 ({analyzedCount}개)
                            </>
                        )}
                    </button>
                </form>
            </div>
        );
    };

    const Modal = ({ children }) => (
        // Increased max-w-xl for more space when adding multiple items
        <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900 bg-opacity-75 flex justify-center items-center p-4">
            <div className="bg-white rounded-xl max-w-xl w-full shadow-2xl relative">
                <button
                    onClick={() => setModal({ isOpen: false, type: '', data: null })}
                    className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition"
                >
                    <XCircle size={24} />
                </button>
                {children}
            </div>
        </div>
    );

    // --- Main Render (Unchanged) ---
    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-[Inter]">
            <header className="mb-8">
                <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">단조 시방서 통합 관리 시스템</h1>
                <p className="text-lg text-gray-600 mt-1">AI 요약 및 키워드 검색 기반의 문서 접근성 향상</p>
                <div className="mt-2 text-xs text-gray-400">
                    사용자 ID: {userId || '인증 대기 중...'} (개인 데이터 저장 경로)
                </div>
            </header>

            {/* Error Message */}
            {/* Display error if there is a global init error OR a local runtime error */}
            {(globalInitError || error) && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-6 whitespace-pre-wrap" role="alert">
                    <strong className="font-bold">오류 발생!</strong>
                    <span className="block sm:inline ml-2">{globalInitError || error}</span>
                </div>
            )}
            
            <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4 mb-8">
                {/* Search Bar */}
                <div className="relative flex-grow">
                    <input
                        type="text"
                        placeholder="문서 제목, 키워드, 내용으로 검색..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full rounded-lg border-2 border-gray-300 p-3 pl-10 shadow-inner focus:border-indigo-500 focus:ring-indigo-500 transition"
                    />
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                </div>
                
                {/* Upload Button */}
                <button
                    onClick={() => setModal({ isOpen: true, type: 'upload', data: null })}
                    // FIX: Global initialization error 시 버튼 비활성화
                    disabled={!!globalInitError || !isAuthReady || loading} 
                    className="flex items-center justify-center py-3 px-6 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition shadow-lg disabled:bg-gray-400"
                >
                    <Upload size={20} className="mr-2" />
                    시방서 등록 (메타데이터)
                </button>
            </div>
            
            {/* Spec List */}
            <div className="space-y-4">
                {isAuthReady && specs.length === 0 && !loading && (
                    <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                        <FileText size={48} className="mx-auto text-gray-300" />
                        <p className="mt-3 text-lg font-medium">등록된 시방서가 없습니다.</p>
                        <p className="text-sm">상단의 '시방서 등록' 버튼으로 새로운 문서를 추가해보세요.</p>
                    </div>
                )}
                
                {loading && (
                    <div className="flex justify-center items-center py-10 text-indigo-600">
                        <Loader2 size={32} className="animate-spin mr-3" />
                        <p className="text-lg font-medium">데이터를 로드하고 있습니다...</p>
                    </div>
                )}

                {filteredSpecs.map(spec => (
                    <SpecCard key={spec.id} spec={spec} />
                ))}

                {searchTerm && filteredSpecs.length === 0 && (
                     <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                        <p className="text-lg font-medium">'{searchTerm}'에 대한 검색 결과가 없습니다.</p>
                        <p className="text-sm">다른 키워드로 검색해보거나 문서를 등록해주세요.</p>
                    </div>
                )}
            </div>
            
            {/* Modals */}
            {modal.isOpen && modal.type === 'upload' && (
                <Modal>
                    <SpecUploadModal />
                </Modal>
            )}

            {modal.isOpen && modal.type === 'preview' && modal.data && (
                <Modal>
                    <div className="p-6">
                        <h3 className="text-2xl font-bold text-gray-800 mb-2">{modal.data.fileName}</h3>
                        <p className="text-sm font-medium text-indigo-600 mb-4">{modal.data.fileType} 파일 요약 (AI 미리보기)</p>
                        
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
                            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                                {modal.data.summary || "AI 요약 내용이 없습니다."}
                            </p>
                        </div>
                        
                        <div className="mt-4">
                            <p className="text-sm font-medium text-gray-700 mb-1">주요 키워드</p>
                            <div className="flex flex-wrap gap-2">
                                {modal.data.keywords && modal.data.keywords.map((k, i) => (
                                    <span key={i} className="px-3 py-1 bg-indigo-100 text-indigo-800 text-sm font-medium rounded-full">{k}</span>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => setModal({ isOpen: false, type: '', data: null })}
                            className="mt-6 w-full py-2 px-4 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition"
                        >
                            닫기
                        </button>
                    </div>
                </Modal>
            )}

            {modal.isOpen && modal.type === 'info' && (
                <Modal>
                    <div className="p-6 text-center">
                        <h3 className="text-xl font-bold text-gray-800 mb-4">기능 안내</h3>
                        <p className="text-gray-600">{modal.data}</p>
                        <button
                            onClick={() => setModal({ isOpen: false, type: '', data: null })}
                            className="mt-6 py-2 px-4 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition"
                        >
                            확인
                        </button>
                    </div>
                </Modal>
            )}

        </div>
    );
};

export default ForgingSpecManager;
