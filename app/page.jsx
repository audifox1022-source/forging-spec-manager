"use client"; // <-- 이 줄은 유지되어야 합니다.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'; // signInWithCustomToken 제거
import { getFirestore, collection, query, onSnapshot, addDoc, doc, deleteDoc, orderBy, serverTimestamp } from 'firebase/firestore'; 
import { Search, FileText, Download, Upload, Trash2, Loader2, XCircle, Zap, File, ListChecks, AlertTriangle } from 'lucide-react';

// --- Configuration Values (고객님이 제공한 값을 코드에 직접 적용) ---
// 경고: 환경 변수가 아닌 코드에 직접 키를 넣는 방식입니다. 보안에 유의하세요.
const firebaseConfig = {
    apiKey: "AIzaSyCB43xipDeVyZVu4sAdtF0lGFIzzCfrsIc",
    authDomain: "forging-spec-manager.firebaseapp.com",
    projectId: "forging-spec-manager",
    storageBucket: "forging-spec-manager.firebasestorage.app",
    messagingSenderId: "299326184664",
    appId: "1:299326184664:web:cfef24589a3cfe4a504bad",
    measurementId: "G-0935D7SKB1"
};

// Gemini API Key는 환경 변수에서 읽어오거나 비워둡니다 (Canvas에서 자동 주입)
let envApiKey = "";
if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GEMINI_API_KEY) {
    envApiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
}

// Helper function to truncate keys for safe display
const truncateKey = (key) => (key && typeof key === 'string' && key.length > 10 ? key.substring(0, 6) + '...' + key.substring(key.length - 4) : key || 'N/A');

// FIX: Sanitize the appId to prevent Firestore path errors caused by slashes in the environment variable.
const sanitizeAppId = (id) => {
    if (typeof id === 'string') {
        // Replace slashes (/) with hyphens (-) as slashes break Firestore paths.
        // Also replace dots (.) with underscores (_) for general ID safety.
        return id.replace(/\//g, '-').replace(/\./g, '_');
    }
    return firebaseConfig.projectId || 'spec-manager-v1'; 
};

// --- Global Variables ---
// Canvas app ID를 최우선으로 사용, 없을 경우 프로젝트 ID를 기반으로 생성
const appId = sanitizeAppId(typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId);
const apiKey = envApiKey || ""; 

const API_URL = `https://generativ
