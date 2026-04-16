import { useState, useMemo, useEffect } from 'react';
import { Calculator, RotateCcw, IndianRupee, Wallet, Plus, ArrowLeft, AlertCircle, History, CreditCard, Clock, CheckCircle2, Download, LogIn, LogOut, Sun, Moon } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { collection, onSnapshot, query, addDoc, where } from 'firebase/firestore';

const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1];

type DepositRecord = {
  id: string;
  uid: string;
  timestamp: number;
  expectedCOD: number;
  actualCash: number;
  onlineAmount: number;
  dueAmount: number;
  notes: Record<number, number>;
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [asyncError, setAsyncError] = useState<Error | null>(null);

  if (asyncError) throw asyncError;

  const [view, setView] = useState<'dashboard' | 'enter_cod' | 'calculator'>('dashboard');
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [expectedCOD, setExpectedCOD] = useState<number | ''>('');
  const [showModal, setShowModal] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const [notes, setNotes] = useState<Record<number, number>>(
    DENOMINATIONS.reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {})
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) {
      setDeposits([]);
      return;
    }

    const q = query(collection(db, 'deposits'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedDeposits: DepositRecord[] = [];
      snapshot.forEach((doc) => {
        fetchedDeposits.push({ id: doc.id, ...doc.data() } as DepositRecord);
      });
      // Sort by timestamp descending
      fetchedDeposits.sort((a, b) => b.timestamp - a.timestamp);
      setDeposits(fetchedDeposits);
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'deposits');
      } catch (e) {
        setAsyncError(e as Error);
      }
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
      setAsyncError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout failed', error);
      setAsyncError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const handleNoteChange = (denomination: number, value: string) => {
    const parsedValue = parseInt(value, 10);
    setNotes((prev) => ({
      ...prev,
      [denomination]: isNaN(parsedValue) || parsedValue < 0 ? 0 : parsedValue,
    }));
  };

  const { totalAmount, totalNotes } = useMemo(() => {
    let amount = 0;
    let count = 0;
    for (const [denomination, qty] of Object.entries(notes)) {
      amount += Number(denomination) * qty;
      count += qty;
    }
    return { totalAmount: amount, totalNotes: count };
  }, [notes]);

  const formatIndianNumber = (num: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const handleReset = () => {
    setNotes(DENOMINATIONS.reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {}));
  };

  const handleSubmit = () => {
    if (expectedCOD === '') return;
    if (totalAmount === Number(expectedCOD)) {
      saveDeposit(0, 0);
    } else {
      setShowModal(true);
    }
  };

  const saveDeposit = async (online: number, due: number) => {
    if (!user) return;

    const recordData = {
      uid: user.uid,
      timestamp: Date.now(),
      expectedCOD: Number(expectedCOD),
      actualCash: totalAmount,
      onlineAmount: online,
      dueAmount: due,
      notes: { ...notes }
    };
    
    try {
      await addDoc(collection(db, 'deposits'), recordData);
      
      // Reset state and return to dashboard
      handleReset();
      setExpectedCOD('');
      setShowModal(false);
      setView('dashboard');
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, 'deposits');
      } catch (e) {
        setAsyncError(e as Error);
      }
    }
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(deposits, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `cod_deposits_backup_${new Date().toISOString().split('T')[0]}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  if (!isAuthReady) {
    return <div className="min-h-screen bg-[#f8f9fa] dark:bg-slate-950 flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-fuchsia-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 flex items-center justify-center p-3 sm:p-4 font-sans relative overflow-hidden transition-colors duration-500">
        <div className="absolute top-4 right-4 z-50">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)} 
            className="p-3 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-full shadow-sm text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-all border border-white/60 dark:border-slate-700/50"
            title="Toggle Theme"
          >
            {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-indigo-600" />}
          </button>
        </div>

        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-64 sm:w-96 h-64 sm:h-96 bg-indigo-300 dark:bg-indigo-900/40 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 animate-blob transition-colors duration-500"></div>
        <div className="absolute top-0 right-0 w-64 sm:w-96 h-64 sm:h-96 bg-fuchsia-300 dark:bg-fuchsia-900/40 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-3xl opacity-20 animate-blob transition-colors duration-500"></div>

        <div className="bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl p-6 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_8px_32px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] border border-white/80 dark:border-slate-700/50 w-[95%] max-w-md text-center relative z-10 hover:shadow-[0_8px_40px_rgb(0,0,0,0.08)] dark:hover:shadow-[0_8px_40px_rgba(0,0,0,0.3)] transition-all duration-500">
          <div className="w-16 sm:w-20 h-16 sm:h-20 bg-gradient-to-tr from-indigo-600 to-fuchsia-600 dark:from-indigo-500 dark:to-fuchsia-500 text-white rounded-[1.25rem] sm:rounded-3xl flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-xl shadow-indigo-500/30 transform -rotate-6 transition-transform hover:rotate-0 duration-300">
            <Wallet size={32} className="transform rotate-6 sm:w-9 sm:h-9" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 dark:text-white mb-2 sm:mb-3 tracking-tight">cod<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-fuchsia-600 dark:from-indigo-400 dark:to-fuchsia-400">55</span></h1>
          <p className="text-slate-500 dark:text-slate-400 mb-8 sm:mb-10 text-base sm:text-lg leading-relaxed font-medium">Sign in to securely manage your daily cash deposits in the cloud.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-gradient-to-r from-slate-900 to-slate-800 dark:from-indigo-600 dark:to-fuchsia-600 text-white px-5 sm:px-6 py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-semibold hover:from-slate-800 hover:to-slate-700 dark:hover:from-indigo-500 dark:hover:to-fuchsia-500 flex items-center justify-center gap-3 shadow-lg shadow-slate-900/20 dark:shadow-indigo-500/20 transition-all hover:-translate-y-0.5 active:translate-y-0 duration-300"
          >
            <LogIn size={20} />
            Continue with Google
          </button>
        </div>
        <div className="absolute bottom-4 sm:bottom-6 text-xs sm:text-sm text-slate-400 dark:text-slate-500 font-medium tracking-wide">
          made by ashistyz
        </div>
      </div>
    );
  }

  const renderDashboard = () => (
    <div className="max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12 relative min-h-screen pt-2 sm:pt-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-6 mb-8 sm:mb-12">
        <div className="relative group">
          <h1 className="text-3xl sm:text-4xl font-display font-bold text-slate-900 tracking-tight flex items-baseline gap-1">
            cod<span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-fuchsia-600">55</span>
          </h1>
          <p className="text-slate-500 mt-1 sm:mt-2 font-medium text-sm sm:text-base">Your intelligent cash ledger</p>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
          <button 
            onClick={handleLogout}
            className="col-span-1 bg-white/70 backdrop-blur-md text-slate-700 border border-white/60 shadow-sm px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl font-semibold hover:bg-white flex items-center gap-2 transition-all hover:shadow-md active:scale-95 justify-center text-sm sm:text-base"
            title="Sign Out"
          >
            <LogOut size={18} className="text-slate-400 sm:w-5 sm:h-5" />
            <span className="inline">Sign Out</span>
          </button>
          <button 
            onClick={handleExport}
            disabled={deposits.length === 0}
            className="col-span-1 bg-white/70 backdrop-blur-md text-slate-700 border border-white/60 shadow-sm px-3 sm:px-4 py-3 sm:py-3.5 rounded-xl sm:rounded-2xl font-semibold hover:bg-white flex items-center gap-2 transition-all hover:shadow-md active:scale-95 justify-center disabled:opacity-50 text-sm sm:text-base"
            title="Download Backup"
          >
            <Download size={18} className="text-indigo-500 sm:w-5 sm:h-5" />
            <span className="inline">Export</span>
          </button>
          <button 
            onClick={() => {
              if (deposits.length > 0) {
                setExpectedCOD(deposits[0].actualCash);
              } else {
                setExpectedCOD('');
              }
              setView('enter_cod');
            }} 
            className="col-span-2 sm:col-span-1 bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white px-5 sm:px-6 py-3.5 rounded-xl sm:rounded-2xl font-bold hover:shadow-lg hover:shadow-indigo-500/30 flex items-center gap-2 transition-all hover:-translate-y-0.5 active:translate-y-0 justify-center text-sm sm:text-base"
          >
            <Plus size={20} />
            New Deposit
          </button>
        </div>
      </div>

      <div className="space-y-5">
        {deposits.length === 0 ? (
          <div className="text-center py-24 bg-white/40 dark:bg-slate-900/40 backdrop-blur-lg rounded-[2.5rem] border border-white/60 dark:border-slate-800 shadow-[0_8px_32px_rgba(0,0,0,0.02)] transition-colors">
            <div className="w-20 h-20 bg-white dark:bg-slate-800 shadow-xl shadow-indigo-100 dark:shadow-none rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
              <History className="h-10 w-10 text-indigo-400 dark:text-indigo-500" />
            </div>
            <h3 className="text-2xl font-display font-semibold text-slate-800 dark:text-slate-200 mb-2">No deposits yet</h3>
            <p className="text-slate-500 dark:text-slate-400 text-lg">Click 'New Deposit' to record your first COD collection.</p>
          </div>
        ) : (
          deposits.map(dep => (
            <div key={dep.id} className="bg-white/70 dark:bg-slate-800/80 backdrop-blur-xl p-5 sm:p-6 md:p-8 rounded-[1.5rem] sm:rounded-[2rem] shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-white dark:border-slate-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6 transition-all hover:shadow-[0_8px_30px_rgba(99,102,241,0.08)] hover:bg-white/90 dark:hover:bg-slate-800 group">
              <div>
                <div className="text-xs sm:text-sm font-medium text-indigo-500/80 dark:text-indigo-400 mb-1.5 sm:mb-2 tracking-wide uppercase">
                  {new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(dep.timestamp))}
                </div>
                <div className="text-xl sm:text-2xl font-display font-bold text-slate-800 dark:text-white flex items-center gap-2 sm:gap-3">
                  <span className="text-slate-400 dark:text-slate-500 font-medium text-base sm:text-lg">Target:</span>
                  {formatIndianNumber(dep.expectedCOD)}
                  {dep.expectedCOD === dep.actualCash && (
                    <div className="bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-1 sm:p-1.5 rounded-full shadow-sm">
                      <CheckCircle2 size={16} className="fill-emerald-100 sm:w-[18px] sm:h-[18px] dark:fill-emerald-500/20" />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2.5 sm:gap-4 md:gap-6 bg-slate-50/50 dark:bg-slate-900/50 md:bg-transparent p-3 sm:p-5 md:p-0 rounded-xl sm:rounded-2xl w-full md:w-auto">
                <div className="bg-white dark:bg-slate-800 md:bg-transparent md:dark:bg-transparent p-3 sm:p-4 md:p-0 rounded-lg sm:rounded-xl shadow-sm md:shadow-none border border-slate-100 dark:border-slate-700 md:border-none md:dark:border-none min-w-[90px] sm:min-w-[100px]">
                  <div className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Cash In</div>
                  <div className="font-display font-bold text-emerald-600 dark:text-emerald-400 text-lg sm:text-xl md:text-2xl">{formatIndianNumber(dep.actualCash)}</div>
                </div>
                {dep.onlineAmount !== 0 && (
                  <div className="bg-white dark:bg-slate-800 md:bg-transparent md:dark:bg-transparent p-3 sm:p-4 md:p-0 rounded-lg sm:rounded-xl shadow-sm md:shadow-none border border-slate-100 dark:border-slate-700 md:border-none md:dark:border-none min-w-[90px] sm:min-w-[100px]">
                    <div className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Online</div>
                    <div className="font-display font-bold text-indigo-600 dark:text-indigo-400 text-lg sm:text-xl md:text-2xl">{formatIndianNumber(dep.onlineAmount)}</div>
                  </div>
                )}
                {dep.dueAmount !== 0 && (
                  <div className="bg-white dark:bg-slate-800 md:bg-transparent md:dark:bg-transparent p-3 sm:p-4 md:p-0 rounded-lg sm:rounded-xl shadow-sm md:shadow-none border border-slate-100 dark:border-slate-700 md:border-none md:dark:border-none min-w-[90px] sm:min-w-[100px]">
                    <div className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">Due</div>
                    <div className="font-display font-bold text-orange-500 dark:text-orange-400 text-lg sm:text-xl md:text-2xl">{formatIndianNumber(dep.dueAmount)}</div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="absolute bottom-4 left-0 right-0 text-center text-sm text-gray-400 font-medium">
        made by ashistyz
      </div>
    </div>
  );

  const renderEnterCOD = () => (
    <div className="max-w-xl mx-auto w-full animate-in zoom-in-95 duration-500 pt-4 sm:pt-10">
      <button 
        onClick={() => setView('dashboard')}
        className="mb-6 sm:mb-8 flex items-center gap-2 sm:gap-3 text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold transition-colors group"
      >
        <div className="p-2 sm:p-2.5 bg-white dark:bg-slate-800 rounded-full shadow-sm group-hover:shadow-md transition-all">
          <ArrowLeft size={18} />
        </div>
        Back to Dashboard
      </button>
      
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_8px_40px_rgba(0,0,0,0.04)] p-6 sm:p-10 text-center border border-white dark:border-slate-800">
        <div className="w-16 sm:w-20 h-16 sm:h-20 bg-gradient-to-tr from-indigo-500 to-indigo-600 text-white rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-lg shadow-indigo-500/30 transform rotate-3">
          <Wallet size={32} className="transform -rotate-3 sm:w-9 sm:h-9" />
        </div>
        <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-900 dark:text-white mb-2 sm:mb-3">Expected COD</h2>
        <p className="text-slate-500 dark:text-slate-400 mb-8 sm:mb-10 text-base sm:text-lg">Enter the exact target amount to deposit today.</p>
        
        <div className="relative mb-8 sm:mb-10 group">
          <span className="absolute left-6 sm:left-8 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 text-2xl sm:text-3xl font-display font-medium">₹</span>
          <input 
            type="number" 
            value={expectedCOD} 
            onChange={e => setExpectedCOD(e.target.value ? Number(e.target.value) : '')}
            placeholder="0"
            className="w-full text-4xl sm:text-6xl font-display font-bold text-center py-6 sm:py-8 bg-slate-50/50 dark:bg-slate-950/50 border-2 border-slate-100 dark:border-slate-800 rounded-2xl sm:rounded-[2rem] focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 dark:focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 outline-none transition-all text-slate-800 dark:text-slate-200 placeholder:text-slate-200 dark:placeholder:text-slate-700"
            autoFocus
          />
        </div>
        
        <button 
          onClick={() => setView('calculator')} 
          disabled={expectedCOD === '' || Number(expectedCOD) <= 0} 
          className="w-full py-4 sm:py-5 rounded-xl sm:rounded-[1.5rem] font-bold text-base sm:text-lg text-white bg-gradient-to-r from-indigo-600 to-fuchsia-600 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-50 disabled:grayscale transition-all hover:-translate-y-0.5 active:translate-y-0"
        >
          Continue to Calculator
        </button>
      </div>
    </div>
  );

  const renderCalculator = () => (
    <div className="max-w-5xl mx-auto w-full animate-in slide-in-from-right-8 duration-500 pt-2 sm:pt-6 pb-44 md:pb-12">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-4">
        <button 
          onClick={() => setView('enter_cod')}
          className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 font-semibold transition-colors bg-white/70 backdrop-blur-md px-4 sm:px-5 py-2 sm:py-2.5 rounded-full shadow-sm border border-white/60 hover:bg-white hover:shadow-md text-sm sm:text-base"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <div className="bg-indigo-50 text-indigo-700 px-4 sm:px-5 py-2 sm:py-2.5 rounded-full font-semibold text-sm border border-indigo-100 flex items-center gap-2 shadow-sm shrink-0 w-full sm:w-auto justify-between sm:justify-start">
          <span className="uppercase tracking-wider text-xs">Target COD:</span>
          <span className="text-base sm:text-lg font-display font-bold">{formatIndianNumber(Number(expectedCOD))}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 lg:gap-8">
        {/* Left Column: Calculator Inputs */}
        <div className="md:col-span-7 bg-white/80 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] shadow-[0_4px_24px_rgba(0,0,0,0.03)] p-4 sm:p-6 md:p-8 border border-white">
          <div className="flex items-center justify-between mb-6 sm:mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 sm:w-12 h-10 sm:h-12 rounded-xl sm:rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100">
                <Calculator size={20} className="sm:w-6 sm:h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-slate-900">Count Cash</h1>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-500 hover:text-indigo-600 transition-colors px-3 sm:px-4 py-2 rounded-full hover:bg-indigo-50"
            >
              <RotateCcw size={14} className="sm:w-4 sm:h-4" />
              Reset
            </button>
          </div>

          <div className="space-y-2 sm:space-y-3">
            <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-2 sm:gap-4 px-2 sm:px-3 pb-2 sm:pb-3 border-b border-slate-100 text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">
              <div>Note</div>
              <div className="text-center">Count</div>
              <div className="text-right">Amount</div>
            </div>

            {DENOMINATIONS.map((den) => {
              const qty = notes[den];
              const amount = den * qty;
              return (
                <div
                  key={den}
                  className="grid grid-cols-[1fr_1fr_1.5fr] gap-4 items-center p-2 rounded-2xl hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-2 font-display font-semibold text-slate-700 text-lg">
                    <span className="text-slate-400 text-base font-medium">₹</span>
                    {den}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      value={qty === 0 ? '' : qty}
                      onChange={(e) => handleNoteChange(den, e.target.value)}
                      placeholder="0"
                      className="w-full bg-slate-50/80 border-2 border-slate-100/50 rounded-2xl py-3 px-4 text-center text-slate-900 font-display font-semibold text-lg focus:outline-none focus:ring-4 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all placeholder:text-slate-300"
                    />
                  </div>
                  <div className="text-right font-display font-bold text-slate-400 group-hover:text-slate-700 transition-colors text-xl">
                    {amount > 0 ? formatIndianNumber(amount) : '-'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Summary & Submit */}
        <div className="md:col-span-5 space-y-6 mt-4 md:mt-0">
          <div className="bg-white/95 backdrop-blur-3xl rounded-t-[2rem] md:rounded-[2.5rem] shadow-[0_-8px_40px_rgba(0,0,0,0.08)] md:shadow-[0_8px_32px_rgba(0,0,0,0.04)] p-6 md:p-8 fixed bottom-0 left-0 right-0 z-50 md:sticky md:top-8 border-t md:border border-white/80">
            <h2 className="hidden md:block text-xs font-bold text-slate-400 uppercase tracking-wider mb-8">Summary</h2>
            
            <div className="flex flex-row items-center justify-between md:flex-col md:items-start space-y-0 md:space-y-8 mb-4 md:mb-0">
              <div>
                <div className="flex items-center gap-1 sm:gap-2 text-slate-500 mb-1 sm:mb-2">
                  <span className="text-xs sm:text-sm font-semibold tracking-wide flex items-center gap-1 sm:gap-1.5"><IndianRupee size={16} className="w-4 h-4 sm:w-auto"/> Calculated Cash</span>
                </div>
                <div className={`text-4xl sm:text-5xl font-display font-bold tracking-tight break-words transition-colors duration-500 ${totalAmount === Number(expectedCOD) ? 'text-emerald-500' : 'text-slate-900'}`}>
                  {formatIndianNumber(totalAmount)}
                </div>
              </div>

              <div className="hidden md:block h-px bg-slate-100 w-full"></div>

              <div>
                <div className="flex items-center gap-1 sm:gap-2 text-slate-500 mb-1 sm:mb-2 justify-end md:justify-start">
                  <span className="text-[10px] sm:text-sm font-semibold tracking-wide flex items-center gap-1 sm:gap-1.5"><Wallet size={16} className="w-3 h-3 sm:w-auto"/> Total Notes</span>
                </div>
                <div className="text-xl sm:text-3xl font-display font-bold tracking-tight text-slate-700 text-right md:text-left">
                  {new Intl.NumberFormat('en-IN').format(totalNotes)}
                </div>
              </div>
            </div>

            <button 
              onClick={handleSubmit}
              className={`w-full md:mt-10 py-4 sm:py-5 rounded-xl sm:rounded-[1.5rem] font-bold text-base sm:text-lg text-white transition-all shadow-xl hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2 ${
                totalAmount === Number(expectedCOD) 
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-emerald-500/20 hover:shadow-emerald-500/40' 
                  : 'bg-gradient-to-r from-indigo-600 to-fuchsia-600 shadow-indigo-500/20 hover:shadow-indigo-500/40'
              }`}
            >
              {totalAmount === Number(expectedCOD) ? (
                <>
                  <CheckCircle2 size={24} className="w-5 h-5 sm:w-6 sm:h-6" />
                  Submit Match
                </>
              ) : (
                'Submit Deposit'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderModal = () => {
    if (!showModal) return null;
    const diff = Number(expectedCOD) - totalAmount;
    const absDiff = Math.abs(diff);

    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
        <div className="bg-white/95 backdrop-blur-2xl rounded-[2rem] sm:rounded-[2.5rem] p-6 sm:p-8 max-w-md w-full shadow-[0_16px_60px_rgba(0,0,0,0.1)] animate-in zoom-in-95 duration-200 border border-white">
          <div className="w-16 sm:w-20 h-16 sm:h-20 bg-gradient-to-tr from-amber-400 to-orange-500 text-white rounded-2xl sm:rounded-3xl flex items-center justify-center mx-auto mb-6 transform rotate-3 shadow-lg shadow-orange-500/20">
            <AlertCircle size={32} className="transform -rotate-3 sm:w-10 sm:h-10" />
          </div>
          <h3 className="text-2xl sm:text-3xl font-display font-bold text-center text-slate-900 mb-2">Mismatch</h3>
          
          <div className="bg-slate-50/50 rounded-2xl p-4 mb-6 space-y-3 border border-slate-100">
            <div className="flex justify-between text-sm sm:text-base font-medium">
              <span className="text-slate-500">Target COD:</span>
              <span className="text-slate-900">{formatIndianNumber(Number(expectedCOD))}</span>
            </div>
            <div className="flex justify-between text-sm sm:text-base font-medium">
              <span className="text-slate-500">Calculated:</span>
              <span className="text-slate-900">{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="h-px bg-slate-200 w-full my-2"></div>
            <div className="flex justify-between text-base sm:text-lg font-bold">
              <span className="text-slate-900">Difference:</span>
              <span className="text-orange-600">{formatIndianNumber(absDiff)}</span>
            </div>
          </div>

          <p className="text-sm font-semibold text-slate-600 mb-5 text-center">
            How should we record the remaining {formatIndianNumber(absDiff)}?
          </p>
          
          <div className="grid grid-cols-2 gap-3 mb-4">
            <button 
              onClick={() => saveDeposit(diff, 0)} 
              className="py-4 rounded-xl sm:rounded-2xl font-bold border-2 border-indigo-100 text-indigo-700 bg-white hover:bg-indigo-50 hover:border-indigo-200 flex flex-col items-center gap-2 transition-all hover:-translate-y-0.5 active:scale-95 hover:shadow-md"
            >
              <CreditCard size={24} className="sm:w-8 sm:h-8" />
              Online
            </button>
            <button 
              onClick={() => saveDeposit(0, diff)} 
              className="py-4 rounded-xl sm:rounded-2xl font-bold border-2 border-orange-100 text-orange-700 bg-white hover:bg-orange-50 hover:border-orange-200 flex flex-col items-center gap-2 transition-all hover:-translate-y-0.5 active:scale-95 hover:shadow-md"
            >
              <Clock size={24} className="sm:w-8 sm:h-8" />
              Due
            </button>
          </div>
          
          <button 
            onClick={() => setShowModal(false)} 
            className="w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
          >
            Cancel & Recalculate
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-50 via-slate-50 to-fuchsia-50 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950 text-slate-900 dark:text-slate-100 font-sans p-3 sm:p-4 md:p-8 flex justify-center items-start overflow-x-hidden relative transition-colors duration-500">
      <div className="fixed top-0 left-0 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-indigo-300/30 dark:bg-indigo-900/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-[80px] md:blur-[100px] opacity-60 pointer-events-none transition-colors duration-500"></div>
      <div className="fixed top-0 right-0 w-[300px] md:w-[500px] h-[300px] md:h-[500px] bg-fuchsia-300/30 dark:bg-fuchsia-900/20 rounded-full mix-blend-multiply dark:mix-blend-screen filter blur-[80px] md:blur-[100px] opacity-60 pointer-events-none transition-colors duration-500"></div>
      
      <div className="fixed top-4 right-4 sm:top-6 sm:right-8 z-50">
        <button 
          onClick={() => setIsDarkMode(!isDarkMode)} 
          className="p-3 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-full shadow-sm text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-all border border-white/60 dark:border-slate-700/50"
          title="Toggle Theme"
        >
          {isDarkMode ? <Sun size={20} className="text-amber-400" /> : <Moon size={20} className="text-indigo-600" />}
        </button>
      </div>

      <div className="w-full max-w-7xl mx-auto relative z-10 pt-10 sm:pt-4">
          {view === 'dashboard' && renderDashboard()}
          {view === 'enter_cod' && renderEnterCOD()}
          {view === 'calculator' && renderCalculator()}
          {renderModal()}
        </div>
      </div>
  );
}
