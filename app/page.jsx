"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { Search, FileText, Download, Upload, Trash2, Zap, File, ListChecks, AlertTriangle, Loader2, XCircle, Save, RefreshCw, CheckSquare, Square, AlertCircle, Eye, Grid, List } from 'lucide-react';

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
        request.onerror = (event) => reject(event.target.error);
    });
};

const saveFileToDB = async (id, file) => {
    const db = await openDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        if (!file || !(file instanceof Blob)) {
            console.warn(`[IndexedDB] Invalid file object for ID: ${id}`, file);
            return resolve(); 
        }

        const request = store.put(file, id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => {
            console.error(`[IndexedDB] Save Error for ${id}:`, e.target.error);
            reject(e.target.error);
        };
    });
};

const getFileFromDB = async (id) => {
    const db = await openDB();
    if (!db) return null;
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
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
                    placeholder="검색..." 
                    value={localValue} 
                    onChange={handleChange} 
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pl-9 text-sm focus:outline-none focus:border-indigo-500 transition-colors" 
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
             </div>
             <select 
                value={sortOption} 
                onChange={(e) => onSortChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-2 bg-white text-gray-700 text-sm focus:outline-none focus:border-indigo-500 min-w-[100px]"
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

const SpecCard = React.memo(({ spec, onDelete, onView, onDownload, onPreviewFile, isSelected, onToggleSelect }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    const handleDownloadClick = async () => {
        setIsDownloading(true);
        await onDownload(spec);
        setIsDownloading(false);
    };

    const handleViewClick = () => setTimeout(() => onView(spec), 0);
    const handlePreviewClick = () => setTimeout(() => onPreviewFile(spec), 0);
    const handleDeleteClick = () => setTimeout(() => onDelete(spec.id), 0);
    const handleToggleClick = () => onToggleSelect(spec.id);

    return (
        <div 
            className={`bg-white rounded-lg border transition-all duration-200 hover:shadow-md flex flex-col h-full ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-200'}`}
        >
            <div className="p-4 flex-grow">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={handleToggleClick} 
                            className="text-gray-400 hover:text-indigo-600 focus:outline-none transition-colors"
                            aria-label={isSelected ? "선택 해제" : "선택"}
                        >
                            {isSelected ? <CheckSquare className="text-indigo-600 pointer-events-none" size={20} /> : <Square size={20} className="pointer-events-none" />}
                        </button>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${spec.fileType === 'PDF' ? 'bg-red-50 text-red-600' : spec.fileType === 'XLSX' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                            {spec.fileType}
                        </span>
                    </div>
                    <span className="text-[10px] text-gray-400">
                        {new Date(spec.createdAt).toLocaleDateString()}
                    </span>
                </div>

                <h3 
                    className="text-sm font-semibold text-gray-800 mb-2 break-words line-clamp-2 leading-tight cursor-pointer hover:text-indigo-600 transition-colors" 
                    title={spec.fileName}
                    onClick={handleViewClick}
                >
                    {spec.fileName}
                </h3>
                
                <div className="flex flex-wrap gap-1 mt-auto h-5 overflow-hidden">
                    {spec.keywords && spec.keywords.slice(0, 3).map((k, i) => (
                        <span key={i} className="text-[10px] bg-gray-50 text-gray-500 rounded px-1.5 py-0.5">
                            #{k}
                        </span>
                    ))}
                    {(!spec.keywords || spec.keywords.length === 0) && <span className="text-[10px] italic text-gray-300">키워드 없음</span>}
                </div>
            </div>

            <div className="flex border-t border-gray-100 divide-x divide-gray-100">
                <button
                    onClick={handlePreviewClick}
                    className="flex-1 py-2 flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-indigo-600 transition-colors"
                    title="미리보기"
                >
                    <Eye size={16} className="pointer-events-none" />
                </button>
                <button
                    onClick={handleViewClick}
                    className="flex-1 py-2 flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-blue-600 transition-colors"
                    title="요약 정보"
                >
                    <FileText size={16} className="pointer-events-none" />
                </button>
                <button
                    onClick={handleDownloadClick}
                    disabled={isDownloading}
                    className="flex-1 py-2 flex items-center justify-center text-gray-400 hover:bg-gray-50 hover:text-green-600 transition-colors disabled:opacity-50"
                    title="다운로드"
                >
                    {isDownloading ? <Loader2 size={16} className="animate-spin pointer-events-none" /> : <Download size={16} className="pointer-events-none" />}
                </button>
                <button
                    onClick={handleDeleteClick}
                    className="flex-1 py-2 flex items-center justify-center text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="삭제"
                >
                    <Trash2 size={16} className="pointer-events-none" />
                </button>
            </div>
        </div>
    );
});
SpecCard.displayName = 'SpecCard';

const SpecList = React.memo(({ specs, selectedIds, onToggleSelect, onDelete, onDownload, onView, onPreviewFile }) => {
    if (specs.length === 0) {
        return (
            <div className="text-center py-20 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50">
                <FileText size={40} className="mx-auto mb-3 opacity-50 pointer-events-none" />
                <p className="text-base font-medium">데이터가 없습니다.</p>
                <p className="text-xs mt-1">새로운 시방서를 등록해보세요.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {specs.map(spec => (
                <SpecCard 
                    key={spec.id} 
                    spec={spec} 
                    isSelected={selectedIds.has(spec.id)}
                    onToggleSelect={onToggleSelect}
                    onDelete={onDelete}
                    onDownload={onDownload} 
                    onView={onView}
                    onPreviewFile={onPreviewFile}
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
        <div className={`bg-gray-50 p-3 rounded-lg border ${isAnalyzed ? 'border-green-400 bg-green-50' : isError ? 'border-red-400 bg-red-50' : 'border-gray-200'} transition duration-300`}>
            <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2 overflow-hidden">
                    <span className="font-semibold text-sm text-gray-700 whitespace-nowrap">파일</span>
                    <span className="text-xs text-gray-500 truncate" title={displayFileName}>{displayFileName || "선택된 파일 없음"}</span>
                </div>
                <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    className="text-gray-400 hover:text-red-500 transition"
                    title="항목 제거"
                >
                    <Trash2 size={14} className="pointer-events-none" />
                </button>
            </div>
            
            {item.fileName && (
                <div className="space-y-2">
                     <textarea
                        value={item.mockContent}
                        onChange={(e) => onChange(item.id, 'mockContent', e.target.value)}
                        placeholder="분석 힌트 입력 (선택)"
                        rows="2"
                        className="w-full text-xs rounded border border-gray-300 p-2 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                        disabled={isCurrentAnalyzing}
                    />
                    
                    {isError && (
                        <div className="text-xs text-red-600 font-medium">
                            오류: {item.error}
                        </div>
                    )}
                    
                    <button
                        type="button"
                        onClick={() => onAnalyze(item.id, item)}
                        disabled={!isReadyForAnalysis || isCurrentAnalyzing || isAnalyzing}
                        className={`w-full flex justify-center items-center py-1.5 px-3 rounded text-xs font-medium transition ${
                            isCurrentAnalyzing ? 'bg-yellow-500 text-white' : 
                            isAnalyzed ? 'bg-green-600 text-white hover:bg-green-700' :
                            isReadyForAnalysis ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 
                            'bg-gray-300 text-gray-500'
                        }`}
                    >
                        {isCurrentAnalyzing ? (
                            <>
                                <Loader2 size={14} className="animate-spin mr-1 pointer-events-none" />
                                분석 중...
                            </>
                        ) : isAnalyzed ? (
                            <>
                                <Zap size={14} className="mr-1 pointer-events-none" />
                                재분석
                            </>
                        ) : (
                            <>
                                <Zap size={14} className="mr-1 pointer-events-none" />
                                분석하기
                            </>
                        )}
                    </button>
                </div>
            )}
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

        // INP 최적화: 파일 처리 로직을 비동기로 미룸
        setTimeout(() => {
            const allowedExtensions = ['pdf', 'xlsx', 'xls'];
            const validFiles = files.filter(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                return allowedExtensions.includes(ext);
            });

            if (validFiles.length === 0) {
                alert("PDF 또는 엑셀 파일(.pdf, .xlsx, .xls)만 업로드할 수 있습니다.");
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
        }, 0);

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
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-gray-800">시방서 등록</h3>
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                    <XCircle size={24} className="pointer-events-none" />
                </button>
            </div>
            
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" accept=".pdf, .xlsx, .xls" />
            <input ref={folderInputRef} type="file" {...{ webkitdirectory: "" }} onChange={handleFileSelect} className="hidden" />

            <div className="flex gap-2 mb-4">
                <button type="button" onClick={() => triggerFileInput(false)} className="flex-1 py-2 border border-dashed border-indigo-300 rounded text-sm text-indigo-700 flex justify-center items-center hover:bg-indigo-50 transition">
                    <Upload size={16} className="mr-2 pointer-events-none" /> 파일 선택
                </button>
                <button type="button" onClick={() => triggerFileInput(true)} className="flex-1 py-2 border border-dashed border-indigo-300 rounded text-sm text-indigo-700 flex justify-center items-center hover:bg-indigo-50 transition">
                    <File size={16} className="mr-2 pointer-events-none" /> 폴더 선택
                </button>
            </div>

            {uploadQueue.filter(item => item.fileName).length > 0 && (
                <div className="mb-4">
                    <button type="button" onClick={handleAnalyzeAll} disabled={isAnalyzing || isSaving} className="w-full py-2 bg-purple-600 text-white rounded text-sm flex justify-center items-center hover:bg-purple-700 disabled:bg-gray-400 transition">
                        <Zap size={16} className="mr-2 pointer-events-none" /> 전체 분석
                    </button>
                </div>
            )}

            <div className="space-y-2 mb-4">
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
                className="w-full py-3 bg-green-600 text-white rounded font-bold hover:bg-green-700 disabled:bg-gray-400 flex justify-center items-center transition"
            >
                {isSaving ? <Loader2 size={18} className="mr-2 animate-spin pointer-events-none" /> : <Save size={18} className="mr-2 pointer-events-none" />}
                {isSaving ? "저장 중..." : `저장 (${analyzedCount}개)`}
            </button>
        </div>
    );
};

// --- Main App Component ---
const ForgingSpecManager = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [userId] = useState("Local_User"); 
    const [specs, setSpecs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const deferredSearchTerm = useDeferredValue(searchTerm); 
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
        const savePromises = newSpecs.map(spec => {
            if (spec.file) {
                return saveFileToDB(spec.id, spec.file).catch(err => console.error("File save failed", err));
            }
            return Promise.resolve();
        });

        await Promise.all(savePromises); 

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

    const handlePreviewFile = useCallback(async (spec) => {
        if (spec.fileType !== 'PDF') {
            alert("현재 PDF 파일만 미리보기가 지원됩니다.\n다른 형식의 파일은 다운로드하여 확인해주세요.");
            return;
        }

        try {
            const fileBlob = await getFileFromDB(spec.id);
            if (fileBlob) {
                const url = URL.createObjectURL(fileBlob);
                setModal({ isOpen: true, type: 'file-view', url, fileName: spec.fileName });
            } else {
                alert("원본 파일을 찾을 수 없어 미리보기를 실행할 수 없습니다.");
            }
        } catch (e) {
            console.error("Preview failed:", e);
            alert("미리보기를 불러오는 중 오류가 발생했습니다.");
        }
    }, []);

    const handleView = useCallback((spec) => {
        setModal({ isOpen: true, type: 'preview', data: spec });
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
            message: `선택한 ${selectedIds.size}개의 항목을 정말 삭제하시겠습니까?`,
            onConfirm: () => {
                setConfirmModal({ isOpen: false, message: '', onConfirm: null });
                
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
        e.target.value = '';
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (Array.isArray(importedData)) {
                    setTimeout(() => {
                        setSpecs(prevSpecs => {
                            const mergedSpecs = [...importedData, ...prevSpecs];
                            const uniqueSpecs = mergedSpecs.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
                            saveSpecsToLocalStorage(uniqueSpecs);
                            return uniqueSpecs;
                        });
                        alert("데이터 복원이 완료되었습니다.");
                    }, 0);
                } else {
                    alert("올바르지 않은 JSON 형식입니다.");
                }
            } catch (err) {
                console.error(err);
                alert("파일을 읽는 중 오류가 발생했습니다.");
            }
        };
        reader.readAsText(file);
    };

    const filteredAndSortedSpecs = useMemo(() => {
        let result = specs;
        
        if (deferredSearchTerm) {
            const term = deferredSearchTerm.toLowerCase();
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
    }, [specs, deferredSearchTerm, sortOption]);

    if (!isMounted) return null;

    return (
        <div className="min-h-screen bg-gray-50 p-4 sm:p-8 font-[Inter]">
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b pb-4 border-gray-200">
                <div>
                    <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">단조 시방서 관리</h1>
                    <div className="mt-1 flex items-center text-xs text-gray-500">
                        <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full mr-2">Local Mode</span>
                        사용자: {userId}
                    </div>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                    <button onClick={handleExportData} className="flex-1 md:flex-none flex items-center justify-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm shadow-sm">
                        <Save size={16} className="mr-1.5" /> 백업
                    </button>
                    <button onClick={() => importInputRef.current.click()} className="flex-1 md:flex-none flex items-center justify-center px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm shadow-sm">
                        <RefreshCw size={16} className="mr-1.5" /> 복원
                    </button>
                    <input type="file" ref={importInputRef} onChange={handleImportData} accept=".json" className="hidden" />
                </div>
            </header>
            
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-6 text-sm flex items-center">
                    <AlertTriangle size={16} className="mr-2" />
                    {error}
                </div>
            )}

            <div className="flex flex-col xl:flex-row space-y-3 xl:space-y-0 xl:space-x-3 mb-6">
                <div className="relative flex-grow flex gap-2">
                    <button 
                        onClick={handleSelectAll}
                        className={`flex-shrink-0 flex items-center justify-center w-10 rounded-lg border ${specs.length > 0 && selectedIds.size === specs.length ? 'border-indigo-500 bg-indigo-50 text-indigo-600' : 'border-gray-300 bg-white text-gray-400 hover:bg-gray-50'}`}
                        title="전체 선택"
                    >
                        {specs.length > 0 && selectedIds.size === specs.length ? <CheckSquare size={18} className="pointer-events-none" /> : <Square size={18} className="pointer-events-none" />}
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
                            className="flex items-center justify-center px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 font-medium hover:bg-red-100 whitespace-nowrap transition-colors text-sm"
                        >
                            <Trash2 size={16} className="mr-1.5 pointer-events-none" /> 삭제 ({selectedIds.size})
                        </button>
                    )}
                    <button onClick={() => setModal({ isOpen: true, type: 'upload' })} className="flex-1 md:flex-none flex items-center justify-center px-5 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap transition-colors text-sm shadow-sm">
                        <Upload size={16} className="mr-1.5 pointer-events-none" /> 등록
                    </button>
                </div>
            </div>

            <SpecList 
                specs={filteredAndSortedSpecs} 
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onDelete={handleDelete}
                onDownload={handleDownloadSpec}
                onPreviewFile={handlePreviewFile}
                onView={handleView}
            />

            {modal.isOpen && (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/50 backdrop-blur-sm flex justify-center items-center p-4">
                    <div className={`bg-white rounded-xl shadow-2xl relative border border-gray-200 ${modal.type === 'file-view' ? 'w-full max-w-5xl h-[85vh]' : 'max-w-lg w-full'}`}>
                        {modal.type === 'upload' && (
                            <SpecUploadModal onClose={() => setModal({ isOpen: false })} onSave={handleSave} analyzeFunction={generateSpecMetadata} />
                        )}
                        {modal.type === 'preview' && modal.data && (
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-gray-900 mb-1">{modal.data.fileName}</h3>
                                <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
                                    <span className="font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{modal.data.fileType}</span>
                                    <span>{new Date(modal.data.createdAt).toLocaleString()}</span>
                                </div>
                                
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 max-h-80 overflow-y-auto mb-4 text-sm text-gray-700 leading-relaxed">
                                    <p className="whitespace-pre-wrap">{modal.data.summary}</p>
                                </div>
                                
                                <div className="flex flex-wrap gap-1.5 mb-6">
                                    {modal.data.keywords?.map((k, i) => (
                                        <span key={i} className="px-2 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-md shadow-sm">#{k}</span>
                                    ))}
                                </div>
                                <button onClick={() => setModal({ isOpen: false })} className="w-full py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition text-sm">닫기</button>
                            </div>
                        )}
                        {modal.type === 'file-view' && (
                            <div className="flex flex-col h-full">
                                <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50 rounded-t-xl">
                                    <h3 className="text-base font-bold text-gray-800 truncate pr-4">{modal.fileName}</h3>
                                    <button onClick={() => { URL.revokeObjectURL(modal.url); setModal({ isOpen: false }); }} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-200 transition">
                                        <XCircle size={20} />
                                    </button>
                                </div>
                                <div className="flex-grow bg-gray-100 p-0 overflow-hidden rounded-b-xl">
                                    <iframe src={modal.url} className="w-full h-full border-none" title="PDF Preview" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
            
            {confirmModal.isOpen && (
                <div className="fixed inset-0 z-[60] overflow-y-auto bg-gray-900/50 backdrop-blur-sm flex justify-center items-center p-4">
                     <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl p-6 text-center border border-gray-200">
                        <div className="mx-auto bg-red-100 w-12 h-12 rounded-full flex items-center justify-center mb-4">
                            <Trash2 className="text-red-600 pointer-events-none" size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 mb-2">항목 삭제</h3>
                        <p className="text-gray-600 mb-6 text-sm">선택한 항목을 삭제하시겠습니까?<br/>이 작업은 되돌릴 수 없습니다.</p>
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => setConfirmModal({ isOpen: false, message: '', onConfirm: null })}
                                className="flex-1 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition"
                            >
                                취소
                            </button>
                            <button 
                                onClick={confirmModal.onConfirm}
                                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition shadow-sm"
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
