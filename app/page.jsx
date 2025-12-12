"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { Search, FileText, Download, Upload, Trash2, Zap, File, ListChecks, AlertTriangle, Loader2, XCircle, Save, RefreshCw, CheckSquare, Square, AlertCircle } from 'lucide-react';

// --- Global Constants ---
const LOCAL_STORAGE_KEY = 'forging_specs_data';
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=";

// --- IndexedDB Helper Functions (For Binary File Storage) ---
const DB_NAME = 'ForgingSpecManagerDB';
const DB_VERSION = 5; 
const STORE_NAME = 'files';

const openDB = () => {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') return resolve(null);
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => {
            console.error("IndexedDB Open Error:", event.target.error);
            reject(event.target.error);
        };
    });
};

const saveFileToDB = async (id, file) => {
    try {
        const db = await openDB();
        if (!db) return;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            if (!file) {
                console.warn(`[IndexedDB] 파일이 없어 저장을 건너뜁니다. ID: ${id}`);
                return resolve();
            }

            const request = store.put(file, id); 
            request.onsuccess = () => {
                console.log(`[IndexedDB] 파일 저장 성공! ID: ${id}, Name: ${file.name}, Size: ${file.size}`);
                resolve();
            };
            request.onerror = (e) => {
                console.error(`[IndexedDB] 저장 실패 ID: ${id}:`, e.target.error);
                reject(e.target.error);
            };
        });
    } catch (e) {
        console.error("[IndexedDB] saveFileToDB Exception:", e);
    }
};

const getFileFromDB = async (id) => {
    try {
        const db = await openDB();
        if (!db) return null;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = (event) => {
                const result = event.target.result;
                console.log(`[IndexedDB] 파일 조회 결과 ID: ${id} ->`, result ? "Found" : "Not Found");
                resolve(result);
            };
            request.onerror = (e) => {
                console.error(`[IndexedDB] 조회 실패 ID: ${id}:`, e.target.error);
                reject(e.target.error);
            };
        });
    } catch (e) {
        console.error("[IndexedDB] getFileFromDB Exception:", e);
        return null;
    }
};

const deleteFileFromDB = async (id) => {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
};

// --- Gemini API Key Logic ---
const getCurrentApiKey = () => {
    if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
        return process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    }
    return ""; 
};
const CURRENT_API_KEY = getCurrentApiKey();

// --- Helper Functions ---
const fetchWithRetry = async (url, options, retries = 3) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            if (response.status === 429 && i < retries - 1) { 
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

const loadSpecsFromLocalStorage = () => {
    if (typeof window !== 'undefined') {
        const storedData = localStorage.getItem(LOCAL_STORAGE_KEY);
        try {
            return storedData ? JSON.parse(storedData) : [];
        } catch (e) {
            console.error("Error parsing local storage data:", e);
            return [];
        }
    }
    return [];
};

const saveSpecsToLocalStorage = (specs) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(specs));
    }
};

const safeCreateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

// --- Sub Components ---

const createInitialItem = () => ({
    id: safeCreateId(),
    file: null,
    fileName: '',
    filePath: '',
    fileType: '',
    mockContent: '',
    status: 'pending',
    summary: '',
    keywords: [],
    error: ''
});

// 검색바 컴포넌트
const SearchBar = React.memo(({ onSearchChange, sortOption, onSortChange }) => {
    const [localValue, setLocalValue] = useState("");

    const handleChange = (e) => {
        setLocalValue(e.target.value);
    };

    useEffect(() => {
        const handler = setTimeout(() => {
            onSearchChange(localValue);
        }, 500);

        return () => clearTimeout(handler);
    }, [localValue, onSearchChange]);

    return (
        <div className="relative flex-grow flex gap-2">
             <div className="relative flex-grow">
                <input 
                    type="text" 
                    placeholder="문서 제목, 키워드, 내용으로 검색..." 
                    value={localValue} 
                    onChange={handleChange} 
                    className="w-full rounded-lg border-2 border-gray-300 p-3 pl-10 focus:outline-none focus:border-indigo-500 transition-colors" 
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
             </div>
             <select 
                value={sortOption} 
                onChange={(e) => onSortChange(e.target.value)}
                className="border-2 border-gray-300 rounded-lg p-3 bg-white text-gray-700 focus:outline-none focus:border-indigo-500 min-w-[120px]"
             >
                <option value="date-desc">최신순</option>
                <option value="date-asc">과거순</option>
                <option value="name-asc">이름순</option>
                <option value="type-asc">파일 유형순</option>
             </select>
        </div>
    );
});
SearchBar.displayName = 'SearchBar';

const SpecCard = React.memo(({ spec, onDelete, onView, onDownload, isSelected, onToggleSelect }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownloadClick = async () => {
        setIsDownloading(true);
        console.log(`[SpecCard] 다운로드 요청 ID: ${spec.id}, 파일명: ${spec.fileName}`);
        await onDownload(spec);
        setIsDownloading(false);
    };

    return (
        <div 
            className={`bg-white p-4 rounded-xl shadow-lg transition duration-300 flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-3 sm:space-y-0 sm:space-x-4 border ${isSelected ? 'border-indigo-500 ring-2 ring-indigo-100' : 'border-gray-100 hover:shadow-xl'}`}
        >
            <button 
                onClick={() => onToggleSelect(spec.id)} 
                className="flex-shrink-0 text-gray-400 hover:text-indigo-600 focus:outline-none transition-colors p-1"
                aria-label={isSelected ? "선택 해제" : "선택"}
            >
                {isSelected ? <CheckSquare className="text-indigo-600" size={24} /> : <Square size={24} />}
            </button>

            <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${spec.fileType === 'PDF' ? 'bg-red-100 text-red-600' : spec.fileType === 'XLSX' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                        {spec.fileType}
                    </span>
                    <span className="text-xs text-gray-400">
                        {new Date(spec.createdAt).toLocaleDateString()}
                    </span>
                </div>
                <p className="text-lg font-semibold text-gray-800 break-words truncate">{spec.fileName}</p>
                <div className="text-sm text-gray-500 mt-2 flex items-center flex-wrap gap-1">
                    {spec.keywords && spec.keywords.map((k, i) => (
                        <span key={i} className="text-xs bg-indigo-50 text-indigo-600 rounded-md px-2 py-1 border border-indigo-100">
                            #{k}
                        </span>
                    ))}
                    {(!spec.keywords || spec.keywords.length === 0) && <span className="text-xs italic">키워드 없음</span>}
                </div>
            </div>
            <div className="flex space-x-2 flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0 justify-end">
                <button
                    onClick={() => onView(spec)}
                    className="flex items-center justify-center p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition shadow-md"
                    title="상세보기"
                >
                    <FileText size={18} />
                </button>
                <button
                    onClick={handleDownloadClick}
                    disabled={isDownloading}
                    className="flex items-center justify-center p-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition shadow-md disabled:bg-green-300"
                    title="원본 파일 다운로드"
                >
                    {isDownloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                </button>
                <button
                    onClick={() => onDelete(spec.id)}
                    className="flex items-center justify-center p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition shadow-md"
                    title="삭제"
                >
                    <Trash2 size={18} />
                </button>
            </div>
        </div>
    );
});
SpecCard.displayName = 'SpecCard';

const SpecList = React.memo(({ specs, selectedIds, onToggleSelect, onDelete, onDownload, onView }) => {
    if (specs.length === 0) {
        return (
            <div className="text-center py-10 text-gray-500 border-2 border-dashed border-gray-200 rounded-xl">
                <FileText size={48} className="mx-auto text-gray-300" />
                <p>데이터가 없습니다.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {specs.map(spec => (
                <SpecCard 
                    key={spec.id} 
                    spec={spec} 
                    isSelected={selectedIds.has(spec.id)}
                    onToggleSelect={onToggleSelect}
                    onDelete={onDelete}
                    onDownload={onDownload} 
                    onView={onView} 
                />
            ))}
        </div>
    );
});
SpecList.displayName = 'SpecList';

const UploadItem = React.memo(({ item, onChange, onDelete, onAnalyze, isAnalyzing }) => {
    const getFileTypeFromExtension = (name) => {
        if (!name) return 'N/A';
        const ext = name.split('.').pop().toLowerCase();
        if (['pdf'].includes(ext)) return 'PDF';
        if (['xlsx', 'xls'].includes(ext)) return 'XLSX';
        if (['zip', 'rar', '7z'].includes(ext)) return 'ZIP';
        return 'ETC';
    };

    const isReadyForAnalysis = item.fileName && (CURRENT_API_KEY);
    const isAnalyzed = item.status === 'analyzed';
    const isError = item.status === 'error';
    const isCurrentAnalyzing = item.status === 'analyzing';

    const displayFileName = item.filePath ? `${item.filePath}/${item.fileName}` : item.fileName;

    return (
        <div className={`bg-gray-100 p-4 rounded-lg border-2 ${isAnalyzed ? 'border-green-400' : isError ? 'border-red-400' : 'border-gray-200'} shadow-inner mb-4 transition duration-300`}>
            <div className="flex justify-between items-start mb-2">
                <h4 className="font-semibold text-gray-700">문서</h4>
                <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    className="text-red-500 hover:text-red-700 transition"
                    title="항목 제거"
                >
                    <Trash2 size={16} />
                </button>
            </div>
            <div className="space-y-3">
                <div>
                    <label className="block text-sm font-medium text-gray-700">선택된 파일</label>
                    <div className="mt-1 flex items-center bg-white p-2 rounded-lg border border-gray-300 shadow-sm text-gray-800">
                        <File size={16} className="mr-2 text-indigo-500" />
                        <span className='truncate'>{displayFileName || "파일을 선택해주세요."}</span>
                        <span className="ml-auto font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-xs">
                            {item.fileName ? getFileTypeFromExtension(item.fileName) : 'N/A'}
                        </span>
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700">AI 분석용 핵심 정보 (선택 사항)</label>
                    <textarea
                        value={item.mockContent}
                        onChange={(e) => onChange(item.id, 'mockContent', e.target.value)}
                        placeholder="문서의 주요 내용 입력 (비워두면 파일명 기반 분석)"
                        rows="3"
                        className="mt-1 block w-full rounded-lg border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                        disabled={isCurrentAnalyzing || !item.fileName}
                    />
                </div>
            </div>
            
            <div className="mt-4 border-t pt-3 border-gray-200">
                {isAnalyzed && (
                    <div className="bg-green-50 text-green-700 p-2 rounded-lg text-sm mb-2">
                        <span className="font-bold">분석 완료</span>
                    </div>
                )}
                {isError && (
                    <div className="bg-red-50 text-red-700 p-2 rounded-lg text-sm mb-2">
                        <span className="font-bold">오류:</span> {item.error}
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
                            재분석
                        </>
                    ) : (
                        <>
                            <Zap size={16} className="mr-2" />
                            분석하기
                        </>
                    )}
                </button>
            </div>
        </div>
    );
});
UploadItem.displayName = 'UploadItem';

const SpecUploadModal = ({ onClose, onSave, analyzeFunction }) => {
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);

    const [uploadQueue, setUploadQueue] = useState([createInitialItem()]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const analyzedCount = uploadQueue.filter(item => item.fileName && item.status === 'analyzed').length;

    const handleFileSelect = useCallback((event) => {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        const allowedExtensions = ['pdf', 'xlsx', 'xls'];
        const validFiles = files.filter(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            return allowedExtensions.includes(ext);
        });

        if (validFiles.length === 0) {
            alert("PDF 또는 엑셀 파일(.pdf, .xlsx, .xls)만 업로드할 수 있습니다.");
            event.target.value = '';
            return;
        }

        const newSpecs = validFiles.map(file => {
            const parts = file.name.split('.');
            const ext = parts.pop().toLowerCase();
            let fileType = 'ETC';
            if(ext === 'pdf') fileType = 'PDF';
            else if(ext === 'xlsx' || ext === 'xls') fileType = 'XLSX';

            let filePath = '';
            if (file.webkitRelativePath) {
                const pathParts = file.webkitRelativePath.split('/');
                filePath = pathParts.slice(0, -1).join('/'); 
            }
            
            return {
                id: safeCreateId(),
                file: file, 
                fileName: file.name,
                filePath: filePath, 
                fileType: fileType, 
                mockContent: '', 
                status: 'pending', 
                summary: '', 
                keywords: [], 
                error: ''
            };
        });
        
        setUploadQueue(prev => {
            const existingFiles = prev.filter(item => item.fileName);
            return [...existingFiles, ...newSpecs, createInitialItem()];
        });

        event.target.value = ''; 
    }, []);

    const handleRemoveItem = useCallback((id) => {
        setUploadQueue(prev => prev.filter((item) => item.id !== id));
    }, []);

    const handleInputChange = useCallback((id, field, value) => {
        setUploadQueue(prev => prev.map((item) => {
            if (item.id === id) {
                return { 
                    ...item, 
                    [field]: value, 
                    status: (item.status === 'analyzed' || item.status === 'error') ? 'pending' : item.status,
                };
            }
            return item;
        }));
    }, []);

    const handleAnalyzeItem = useCallback(async (id, item) => {
        setIsAnalyzing(true);
        setUploadQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'analyzing', error: '' } : q));
        
        try {
            const result = await analyzeFunction(item);
            setUploadQueue(prev => prev.map(q => q.id === id ? { ...q, ...result, status: 'analyzed' } : q));
        } catch (e) {
            setUploadQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'error', error: e.message } : q));
        } finally {
            setIsAnalyzing(false);
        }
    }, [analyzeFunction]);

    const handleAnalyzeAll = async () => {
        const itemsToAnalyze = uploadQueue.filter(item => item.fileName && (item.status === 'pending' || item.status === 'error'));
        if (itemsToAnalyze.length === 0) {
            alert("분석할 항목이 없습니다.");
            return;
        }

        setIsAnalyzing(true);
        await Promise.all(itemsToAnalyze.map(item => handleAnalyzeItem(item.id, item)));
        setIsAnalyzing(false);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const specsToSave = uploadQueue.filter(item => item.status === 'analyzed');
        if (specsToSave.length === 0) {
            alert("저장할 분석 완료 항목이 없습니다.");
            return;
        }
        setIsSaving(true);
        await onSave(specsToSave);
        setIsSaving(false);
    };

    const triggerFileInput = (isFolder) => {
        if (isFolder && folderInputRef.current) {
            folderInputRef.current.click();
        } else if (!isFolder && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <div className="p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">시방서 등록 및 AI 분석</h3>
            <p className="text-sm text-gray-500 mb-4">
                PDF, Excel 파일을 선택하여 분석합니다.<br/>
                <span className="text-xs text-blue-500">* 파일은 브라우저(IndexedDB)에 저장되어 다운로드 가능합니다. 캐시 삭제 시 사라집니다.</span>
            </p>
            
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" accept=".pdf, .xlsx, .xls" />
            <input ref={folderInputRef} type="file" {...{ webkitdirectory: "" }} onChange={handleFileSelect} className="hidden" />

            <div className="mb-6 space-y-2 border-b pb-4">
                <button type="button" onClick={() => triggerFileInput(false)} className="w-full py-3 border-2 border-dashed border-indigo-300 rounded-lg text-indigo-700 flex justify-center items-center hover:bg-indigo-50">
                    <Upload size={20} className="mr-2" /> 개별 파일 선택
                </button>
                <button type="button" onClick={() => triggerFileInput(true)} className="w-full py-3 border-2 border-dashed border-indigo-300 rounded-lg text-indigo-700 flex justify-center items-center hover:bg-indigo-50">
                    <File size={20} className="mr-2" /> 폴더 선택 (PDF/Excel만 자동 선택)
                </button>
                
                 {uploadQueue.filter(item => item.fileName).length > 0 && (
                    <button type="button" onClick={handleAnalyzeAll} disabled={isAnalyzing || isSaving} className="w-full py-3 bg-purple-600 text-white rounded-lg flex justify-center items-center mt-2 hover:bg-purple-700 disabled:bg-gray-400">
                        <Zap size={18} className="mr-2" /> 일괄 분석하기
                    </button>
                 )}
            </div>

            <div className="space-y-4">
                 {uploadQueue.filter(item => item.fileName).map((item, index) => (
                    <UploadItem 
                        key={item.id} 
                        item={item} 
                        index={index} 
                        onChange={handleInputChange} 
                        onDelete={handleRemoveItem}
                        onAnalyze={handleAnalyzeItem}
                        isAnalyzing={isAnalyzing}
                    />
                 ))}
            </div>

            <button
                onClick={handleSubmit}
                disabled={analyzedCount === 0 || isAnalyzing || isSaving}
                className="mt-6 w-full py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 disabled:bg-gray-400 flex justify-center items-center"
            >
                {isSaving ? <Loader2 size={20} className="mr-2 animate-spin" /> : <Save size={20} className="mr-2" />}
                {isSaving ? "저장 중..." : `분석 완료 항목 저장 (${analyzedCount}개)`}
            </button>
            
             <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
                <XCircle size={24} />
            </button>
        </div>
    );
};

// --- Main App Component ---
const ForgingSpecManager = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [userId] = useState("Local_User_ID"); 
    const [specs, setSpecs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('date-desc');
    const [modal, setModal] = useState({ isOpen: false, type: '', data: null });
    const [error, setError] = useState('');
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, message: '', onConfirm: null });
    
    const importInputRef = useRef(null); 

    useEffect(() => {
        setIsMounted(true);
        const initialSpecs = loadSpecsFromLocalStorage();
        setSpecs(initialSpecs);
    }, []);

    const generateSpecMetadata = useCallback(async (item) => {
         if (!CURRENT_API_KEY) throw new Error("API Key Missing");
         
         const content = item.mockContent || `파일명: ${item.fileName}, 경로: ${item.filePath}, 타입: ${item.fileType}`;
         
         const systemPrompt = `당신은 전문적인 '단조 시방서' 분석 전문가입니다.`;
         const payload = {
            contents: [{ parts: [{ text: `파일명: ${item.fileName} 내용: ${content}` }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { summary: {type: "STRING"}, keywords: {type: "ARRAY", items: {type: "STRING"}} } } }
         };

         try {
             const response = await fetchWithRetry(`${API_URL}${CURRENT_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
             });
             const result = await response.json();
             const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
             return JSON.parse(jsonText);
         } catch(e) {
             throw new Error("AI 분석 실패: " + e.message);
         }
    }, []);

    const handleSave = useCallback(async (newSpecs) => { 
        // FIX: 모든 파일 저장 약속(Promise)을 기다림 (IndexedDB 저장)
        const savePromises = newSpecs.map(spec => {
            if (spec.file) {
                console.log(`[handleSave] 저장 시도: ${spec.fileName} (ID: ${spec.id})`);
                return saveFileToDB(spec.id, spec.file);
            }
            return Promise.resolve();
        });

        await Promise.all(savePromises); // 저장 완료 대기

        const savedData = newSpecs.map(spec => ({
             id: spec.id,
             fileName: spec.fileName,
             fileType: spec.fileType,
             downloadLink: '#',
             summary: spec.summary,
             keywords: spec.keywords,
             createdAt: new Date().toISOString()
        }));
        
        setSpecs(prevSpecs => {
            const updatedSpecs = [...savedData, ...prevSpecs];
            setTimeout(() => saveSpecsToLocalStorage(updatedSpecs), 0);
            return updatedSpecs;
        });
        setModal({ isOpen: false });
    }, []);

    const handleDelete = useCallback((id) => {
        deleteFileFromDB(id);
        
        setSpecs(prevSpecs => {
            const updated = prevSpecs.filter(s => s.id !== id);
            setTimeout(() => saveSpecsToLocalStorage(updated), 0);
            return updated;
        });
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    }, []);

    const handleDownloadSpec = useCallback(async (spec) => {
        try {
            console.log(`[Download] ID 조회 시도: ${spec.id}`);
            const fileBlob = await getFileFromDB(spec.id);
            
            if (fileBlob) {
                console.log(`[Download] 원본 파일 발견. 다운로드 시작: ${spec.fileName}`);
                const url = URL.createObjectURL(fileBlob);
                const link = document.createElement("a");
                link.href = url;
                link.download = spec.fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                alert("⚠️ 원본 파일을 데이터베이스에서 찾을 수 없습니다.\n브라우저 캐시가 삭제되었거나, 백업된 메타데이터일 수 있습니다.\n\n대신 분석 결과(텍스트)를 다운로드합니다.");
                const content = `=== 단조 시방서 분석 결과 ===\n\n` +
                                `파일명: ${spec.fileName}\n` +
                                `파일 유형: ${spec.fileType}\n` +
                                `등록일: ${new Date(spec.createdAt).toLocaleString()}\n\n` +
                                `[핵심 요약]\n${spec.summary}\n\n` +
                                `[주요 키워드]\n${spec.keywords ? spec.keywords.join(', ') : '없음'}`;
                
                const blob = new Blob([content], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `[분석결과]_${spec.fileName}.txt`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error("Download failed:", error);
            alert("다운로드 중 오류가 발생했습니다.");
        }
    }, []);

    const handleToggleSelect = useCallback((id) => {
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return newSet;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedIds.size === specs.length && specs.length > 0) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(specs.map(s => s.id)));
        }
    }, [specs, selectedIds.size]);

    const handleDeleteSelected = useCallback(() => {
        if (selectedIds.size === 0) return;
        
        setConfirmModal({
            isOpen: true,
            message: `선택한 ${selectedIds.size}개의 항목을 정말 삭제하시겠습니까? (원본 파일도 함께 삭제됩니다)`,
            onConfirm: () => {
                // 1. 모달 닫기 (INP 개선)
                setConfirmModal({ isOpen: false, message: '', onConfirm: null });
                
                // 2. 삭제 처리 지연 (INP 개선)
                setTimeout(() => {
                    selectedIds.forEach(id => deleteFileFromDB(id));

                    setSpecs(prevSpecs => {
                        const updated = prevSpecs.filter(s => !selectedIds.has(s.id));
                        setTimeout(() => saveSpecsToLocalStorage(updated), 0);
                        return updated;
                    });
                    setSelectedIds(new Set());
                }, 100);
            }
        });
    }, [selectedIds]);

    const handleExportData = () => {
        const dataStr = JSON.stringify(specs, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `spec_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImportData = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (Array.isArray(importedData)) {
                    setSpecs(prevSpecs => {
                        const mergedSpecs = [...importedData, ...prevSpecs];
                        const uniqueSpecs = mergedSpecs.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
                        setTimeout(() => saveSpecsToLocalStorage(uniqueSpecs), 0);
                        return uniqueSpecs;
                    });
                    
                    alert("데이터 복원이 완료되었습니다.");
                } else {
                    alert("올바르지 않은 JSON 형식입니다.");
                }
            } catch (err) {
                console.error(err);
                alert("파일을 읽는 중 오류가 발생했습니다.");
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    };

    const filteredAndSortedSpecs = useMemo(() => {
        let result = specs;
        
        // 검색 필터 (지연된 검색어 사용)
        if (searchTerm) { // NOTE: searchTerm은 SearchBar에서 이미 debounce되어 넘어옴
            const term = searchTerm.toLowerCase();
            result = result.filter(s => 
                s.fileName.toLowerCase().includes(term) || 
                s.summary?.toLowerCase().includes(term) ||
                (s.keywords && s.keywords.some(k => k.toLowerCase().includes(term)))
            );
        }

        return [...result].sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();

            switch (sortOption) {
                case 'date-desc': return dateB - dateA; 
                case 'date-asc': return dateA - dateB;   
                case 'name-asc': return a.fileName.localeCompare(b.fileName); 
                case 'type-asc': return a.fileType.localeCompare(b.fileType); 
                default: return 0;
            }
        });
    }, [specs, searchTerm, sortOption]);

    if (!isMounted) return null;

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-[Inter]">
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900">단조 시방서 통합 관리 시스템</h1>
                    <p className="text-lg text-gray-600 mt-1">AI 요약 및 키워드 검색 (Local Storage + IndexedDB)</p>
                    <div className="mt-2 text-xs text-green-600">사용자: {userId} (브라우저 저장소 사용 중)</div>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleExportData} className="flex items-center px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition text-sm">
                        <Save size={16} className="mr-1" /> 백업 저장
                    </button>
                    <button onClick={() => importInputRef.current.click()} className="flex items-center px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition text-sm">
                        <RefreshCw size={16} className="mr-1" /> 백업 복원
                    </button>
                    <input type="file" ref={importInputRef} onChange={handleImportData} accept=".json" className="hidden" />
                </div>
            </header>
            
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">{error}</div>
            )}

            <div className="flex flex-col xl:flex-row space-y-4 xl:space-y-0 xl:space-x-4 mb-8">
                {/* FIX: SearchBar component handles its own debounce */}
                <div className="relative flex-grow flex gap-2">
                    <button 
                        onClick={handleSelectAll}
                        className={`flex items-center justify-center w-12 rounded-lg border-2 ${specs.length > 0 && selectedIds.size === specs.length ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-300 bg-white text-gray-400'}`}
                        title={specs.length > 0 && selectedIds.size === specs.length ? "전체 해제" : "전체 선택"}
                    >
                        {specs.length > 0 && selectedIds.size === specs.length ? <CheckSquare size={20} /> : <Square size={20} />}
                    </button>
                    <SearchBar 
                        onSearchChange={setSearchTerm} 
                        sortOption={sortOption} 
                        onSortChange={setSortOption} 
                    />
                </div>
                <div className="flex gap-2">
                    {selectedIds.size > 0 && (
                        <button 
                            onClick={handleDeleteSelected} 
                            className="flex items-center justify-center py-3 px-6 rounded-lg bg-red-100 text-red-600 font-semibold hover:bg-red-200 whitespace-nowrap transition-colors"
                        >
                            <Trash2 size={20} className="mr-2" /> 선택 삭제 ({selectedIds.size})
                        </button>
                    )}
                    <button onClick={() => setModal({ isOpen: true, type: 'upload' })} className="flex items-center justify-center py-3 px-6 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 whitespace-nowrap transition-colors">
                        <Upload size={20} className="mr-2" /> 시방서 등록
                    </button>
                </div>
            </div>

            <SpecList 
                specs={filteredAndSortedSpecs} 
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onDelete={handleDelete}
                onDownload={handleDownloadSpec}
                onView={(s) => setModal({ isOpen: true, type: 'preview', data: s })}
            />

            {modal.isOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900 bg-opacity-75 flex justify-center items-center p-4">
                    <div className="bg-white rounded-xl max-w-xl w-full shadow-2xl relative">
                        {modal.type === 'upload' && (
                            <SpecUploadModal onClose={() => setModal({ isOpen: false })} onSave={handleSave} analyzeFunction={generateSpecMetadata} />
                        )}
                        {modal.type === 'preview' && modal.data && (
                            <div className="p-6">
                                <h3 className="text-2xl font-bold mb-2">{modal.data.fileName}</h3>
                                <div className="flex items-center justify-between mb-4">
                                    <p className="text-sm text-indigo-600">{modal.data.fileType} 요약</p>
                                    <span className="text-xs text-gray-400">{new Date(modal.data.createdAt).toLocaleString()}</span>
                                </div>
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-80 overflow-y-auto mb-4">
                                    <p className="whitespace-pre-wrap">{modal.data.summary}</p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {modal.data.keywords?.map((k, i) => (
                                        <span key={i} className="px-3 py-1 bg-indigo-100 text-indigo-800 text-sm rounded-full">{k}</span>
                                    ))}
                                </div>
                                <button onClick={() => setModal({ isOpen: false })} className="mt-6 w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">닫기</button>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {confirmModal.isOpen && (
                <div className="fixed inset-0 z-[60] overflow-y-auto bg-gray-900 bg-opacity-75 flex justify-center items-center p-4">
                     <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl p-6 text-center">
                        <AlertCircle className="mx-auto text-red-500 mb-4" size={48} />
                        <h3 className="text-lg font-bold text-gray-900 mb-2">삭제 확인</h3>
                        <p className="text-gray-600 mb-6">{confirmModal.message}</p>
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => setConfirmModal({ isOpen: false, message: '', onConfirm: null })}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
                            >
                                취소
                            </button>
                            <button 
                                onClick={confirmModal.onConfirm}
                                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                            >
                                삭제
                            </button>
                        </div>
                     </div>
                </div>
            )}
        </div>
    );
};

export default ForgingSpecManager;
