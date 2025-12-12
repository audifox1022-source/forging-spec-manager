"use client";
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, FileText, Download, Upload, Trash2, Zap, File, ListChecks, AlertTriangle, Loader2 } from 'lucide-react';

// --- Global Constants ---
const LOCAL_STORAGE_KEY = 'forging_specs_data';
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=";

// Gemini API Key를 환경 변수에서 가져오는 안전한 로직
const getCurrentApiKey = () => {
    // Vercel 환경 변수에서 NEXT_PUBLIC_GEMINI_API_KEY를 가져옴
    if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
        return process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    }
    // Canvas 환경이나 로컬 환경에서 API 키가 없는 경우
    return ""; 
};
const CURRENT_API_KEY = getCurrentApiKey();

// --- Helper Functions ---

// Helper function for exponential backoff retry (AI API 호출용)
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

// Local Storage에서 데이터를 로드하는 함수
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

// Local Storage에 데이터를 저장하는 함수
const saveSpecsToLocalStorage = (specs) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(specs));
    }
};

// 안전한 고유 ID 생성 함수 (클라이언트 측 예외 방지)
const safeCreateId = () => Date.now().toString(36) + Math.random().toString(36).substring(2);


const ForgingSpecManager = () => {
    // Firebase 인증은 사용하지 않으므로 isAuthReady는 항상 true로 간주
    const [isAuthReady] = useState(true); 
    // userId 대신 임시 ID 사용 (로컬 저장소 식별용)
    const [userId] = useState("Local_User_ID"); 
    const [specs, setSpecs] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(false); // 로딩은 데이터 로드 시점에만 사용
    const [modal, setModal] = useState({ isOpen: false, type: '', data: null });
    const [error, setError] = useState('');

    // 1. 초기 로드 (Local Storage에서 데이터 가져오기)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            setLoading(true);
            const initialSpecs = loadSpecsFromLocalStorage();
            setSpecs(initialSpecs);
            setLoading(false);
        }
    }, []);

    // --- Gemini API Handler: Generate Summary & Keywords ---
    const generateSpecMetadata = useCallback(async (fileName, fileContent) => {
        if (!CURRENT_API_KEY) {
            throw new Error("AI 분석을 위한 Gemini API Key가 설정되지 않았습니다. NEXT_PUBLIC_GEMINI_API_KEY를 확인해주세요.");
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
            const response = await fetchWithRetry(`${API_URL}${CURRENT_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!jsonText) throw new Error("AI 응답에서 내용이 누락되었습니다.");

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

    // --- CRUD Operations (Local Storage) ---

    // Spec Registration (Saves PRE-ANALYZED specs to local storage)
    const handleSaveAnalyzedSpecs = async (specsToSave) => {
        setLoading(true); 
        let saveError = '';
        
        const specsToSaveData = specsToSave
            .filter(spec => spec.status === 'analyzed')
            .map(spec => ({
                id: spec.id,
                fileName: spec.fileName,
                fileType: spec.fileType,
                downloadLink: `#mock-link-${Math.random().toString(36).substring(7)}`, 
                summary: spec.summary,
                keywords: spec.keywords,
                createdAt: new Date().toISOString(), // Local timestamp
            }));

        try {
            setSpecs(prevSpecs => {
                // 저장된 새 데이터를 기존 목록 앞에 추가하여 최신 순서 유지
                const newSpecs = [...specsToSaveData, ...prevSpecs];
                saveSpecsToLocalStorage(newSpecs);
                return newSpecs;
            });
        } catch (e) {
            console.error(`Local Storage 저장 실패:`, e);
            saveError = `데이터 저장 실패: ${e.message}`;
        }
        
        setLoading(false);
        setModal({ isOpen: false, type: '', data: null });
        if (saveError) {
             setError(saveError);
        }
    };

    // Spec Deletion
    const handleDeleteSpec = (id) => {
        const newSpecs = specs.filter(spec => spec.id !== id);
        setSpecs(newSpecs);
        saveSpecsToLocalStorage(newSpecs);
    };

    // --- UI/Filtering Logic ---
    const filteredSpecs = useMemo(() => {
        if (!searchTerm) return specs;
        const lowerCaseSearch = searchTerm.toLowerCase();

        return specs.filter(spec =>
            spec.fileName?.toLowerCase().includes(lowerCaseSearch) ||
            spec.keywords?.some(keyword => keyword.toLowerCase().includes(lowerCaseSearch)) ||
            spec.summary?.toLowerCase().includes(lowerCaseSearch)
        );
    }, [specs, searchTerm]);

    // --- Components ---
    
    // Component for a single upload item
    const UploadItem = ({ index, item, onChange, onDelete, onAnalyze, isAnalyzing }) => {
        // fileType extraction based on extension
        const getFileTypeFromExtension = (name) => {
            const ext = name.split('.').pop().toLowerCase();
            if (['pdf'].includes(ext)) return 'PDF';
            if (['xlsx', 'xls'].includes(
