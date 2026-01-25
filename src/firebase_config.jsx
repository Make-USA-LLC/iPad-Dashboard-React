import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  collection, 
  addDoc, 
  getDocs, 
  onSnapshot, 
  serverTimestamp, 
  query, 
  where, 
  orderBy, 
  limit 
} from "firebase/firestore";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail 
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// Re-exporting these allows other files to import them from here
export { 
    onAuthStateChanged, signOut, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
    doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs, onSnapshot, serverTimestamp, 
    query, where, orderBy, limit 
};

// Global State
export let userRole = "none"; 
export let globalPermissions = {};
export let globalWorkers = {};
export let currentUser = null;
export let rolesConfig = {};

// --- DATA LOADER ---
export async function loadUserData(user, callback) {
    if (!user) return;
    
    currentUser = user;
    const emailKey = user.email.toLowerCase();
    
    // 1. Safety Hatch (Admin Bypass)
    if(emailKey === "daniel.s@makeit.buzz" || emailKey === "productionreports@makeit.buzz") { 
        const ref = doc(db, "users", emailKey);
        // Non-blocking write to ensure record exists
        getDoc(ref).then(snap => {
            if (!snap.exists() || snap.data().role !== 'admin') {
                 setDoc(ref, { role: "admin", email: emailKey, allowPassword: true, passwordSet: false }, { merge: true });
            }
        });
        userRole = "admin"; 
    } else {
        // 2. Normal User Load
        try {
            const userDoc = await getDoc(doc(db, "users", emailKey));
            if (userDoc.exists()) {
                const rawRole = userDoc.data().role || "none";
                userRole = rawRole.toLowerCase().trim();
            } else {
                userRole = "unauthorized";
            }
        } catch (e) { 
            console.error("User Load Error:", e); 
            userRole = "none";
        }
    }

    // 3. Load Permissions Config
    try {
        const permDoc = await getDoc(doc(db, "config", "roles"));
        if (permDoc.exists()) { 
            globalPermissions = permDoc.data();
            rolesConfig = permDoc.data(); 
        }
        // Force admin perms locally
        if(userRole === 'admin') {
            globalPermissions['admin'] = { _locked: true };
            rolesConfig['admin'] = { _locked: true };
        }
    } catch (e) { console.error("Config Load Error:", e); }

    // 4. Load Workers
    try {
        const workerSnap = await getDocs(collection(db, "workers"));
        workerSnap.forEach(d => { globalWorkers[d.id] = d.data().name; });
    } catch (e) { console.error(e); }

    console.log(`System Loaded. User: ${emailKey}, Role: ${userRole}`);
    
    if (callback) callback();
}

/**
 * Checks if the current user has permission for a specific feature and mode.
 * @param {string} feature - 'access', 'timer', 'workers', 'finance', 'bonuses', 'settings', 'admin', 'search'
 * @param {string} mode - 'view' or 'edit'
 */
export function checkPermission(feature, mode) {
    // 1. Master Override
    if (userRole === 'admin') return true;
    if (userRole === 'unauthorized' || userRole === 'none') return false;
    
    // 2. Look up Role
    const rolePerms = globalPermissions[userRole];
    
    // 3. Security Check
    if (!rolePerms) {
        console.warn(`Security Warning: Role '${userRole}' has no configuration. Access Denied.`);
        return false;
    }

    if (rolePerms._locked) return true;

    // 4. Check Specific Keys
    const viewKey = `${feature}_view`;
    const editKey = `${feature}_edit`;

    if (mode === 'edit') {
        return rolePerms[editKey] === true;
    }

    if (mode === 'view') {
        return rolePerms[viewKey] === true || rolePerms[editKey] === true;
    }

    return false;
}

export const newIpadDefaults = { 
    companyName: "New Project", isPaused: true, secondsRemaining: 0, activeWorkers: [], timerText: "00:00:00",
    includeTimeRemaining: true, includeWorkerList: true, includeScanHistory: true, includePauseLog: true, includeLunchLog: true, includeTotalTimeWorked: true
};