import { useState, useMemo, useEffect } from 'react';
import { Calculator, RotateCcw, IndianRupee, Wallet, Plus, ArrowLeft, AlertCircle, History, CreditCard, Clock, CheckCircle2, Download, LogIn, LogOut } from 'lucide-react';
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
    return <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <Wallet size={32} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">COD Management</h1>
          <p className="text-gray-500 mb-8">Sign in to track your daily cash deposits securely in the cloud.</p>
          <button 
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl font-semibold hover:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95"
          >
            <LogIn size={20} />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  const renderDashboard = () => (
    <div className="max-w-4xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">COD Management</h1>
          <p className="text-gray-500 mt-1">Track your daily cash deposits</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <button 
            onClick={handleLogout}
            className="bg-white text-gray-700 border border-gray-200 px-4 py-3.5 rounded-2xl font-semibold hover:bg-gray-50 flex items-center gap-2 transition-all active:scale-95 justify-center"
            title="Sign Out"
          >
            <LogOut size={20} />
            <span className="sm:hidden md:inline">Sign Out</span>
          </button>
          <button 
            onClick={handleExport}
            disabled={deposits.length === 0}
            className="bg-white text-gray-700 border border-gray-200 px-4 py-3.5 rounded-2xl font-semibold hover:bg-gray-50 flex items-center gap-2 transition-all active:scale-95 justify-center disabled:opacity-50"
            title="Download Backup"
          >
            <Download size={20} />
            <span className="sm:hidden md:inline">Export</span>
          </button>
          <button 
            onClick={() => setView('enter_cod')} 
            className="bg-blue-600 text-white px-6 py-3.5 rounded-2xl font-semibold hover:bg-blue-700 flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95 justify-center"
          >
            <Plus size={20} />
            New Deposit
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {deposits.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-gray-200 shadow-sm">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <History className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No deposits yet</h3>
            <p className="text-gray-500">Click 'New Deposit' to record your first COD collection.</p>
          </div>
        ) : (
          deposits.map(dep => (
            <div key={dep.id} className="bg-white p-6 rounded-3xl shadow-[0_2px_12px_rgba(0,0,0,0.03)] border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-all hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]">
              <div>
                <div className="text-sm font-medium text-gray-400 mb-1">
                  {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dep.timestamp))}
                </div>
                <div className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  Expected: {formatIndianNumber(dep.expectedCOD)}
                  {dep.expectedCOD === dep.actualCash && (
                    <CheckCircle2 size={18} className="text-green-500" />
                  )}
                </div>
              </div>
              
              <div className="flex flex-wrap gap-6 md:gap-8 bg-gray-50 p-4 rounded-2xl md:bg-transparent md:p-0 md:rounded-none">
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Cash</div>
                  <div className="font-semibold text-green-600 text-lg">{formatIndianNumber(dep.actualCash)}</div>
                </div>
                {dep.onlineAmount !== 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Online</div>
                    <div className="font-semibold text-blue-600 text-lg">{formatIndianNumber(dep.onlineAmount)}</div>
                  </div>
                )}
                {dep.dueAmount !== 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Due</div>
                    <div className="font-semibold text-orange-600 text-lg">{formatIndianNumber(dep.dueAmount)}</div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderEnterCOD = () => (
    <div className="max-w-md mx-auto w-full animate-in zoom-in-95 duration-300">
      <button 
        onClick={() => setView('dashboard')}
        className="mb-6 flex items-center gap-2 text-gray-500 hover:text-gray-900 font-medium transition-colors"
      >
        <ArrowLeft size={20} />
        Back to Dashboard
      </button>
      
      <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgba(0,0,0,0.04)] p-8 text-center border border-gray-100">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Wallet size={32} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Expected COD</h2>
        <p className="text-gray-500 mb-8">Enter the exact amount you are supposed to deposit today.</p>
        
        <div className="relative mb-8">
          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400 text-2xl font-medium">₹</span>
          <input 
            type="number" 
            value={expectedCOD} 
            onChange={e => setExpectedCOD(e.target.value ? Number(e.target.value) : '')}
            placeholder="0"
            className="w-full text-5xl font-light text-center py-6 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white outline-none transition-all"
            autoFocus
          />
        </div>
        
        <button 
          onClick={() => setView('calculator')} 
          disabled={expectedCOD === '' || Number(expectedCOD) <= 0} 
          className="w-full py-4 rounded-2xl font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
        >
          Continue to Calculator
        </button>
      </div>
    </div>
  );

  const renderCalculator = () => (
    <div className="max-w-4xl mx-auto w-full animate-in slide-in-from-right-8 duration-500">
      <div className="flex items-center justify-between mb-6">
        <button 
          onClick={() => setView('enter_cod')}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 font-medium transition-colors bg-white px-4 py-2 rounded-full shadow-sm border border-gray-100"
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-full font-semibold text-sm border border-blue-100 flex items-center gap-2">
          <span>Expected COD:</span>
          <span className="text-lg">{formatIndianNumber(Number(expectedCOD))}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column: Calculator Inputs */}
        <div className="md:col-span-7 bg-white rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 md:p-8 border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                <Calculator size={20} />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-gray-900">Count Cash</h1>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5 rounded-full hover:bg-gray-100"
            >
              <RotateCcw size={16} />
              Reset
            </button>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_1fr_1.5fr] gap-4 px-2 pb-2 border-b border-gray-100 text-xs font-bold text-gray-400 uppercase tracking-wider">
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
                  className="grid grid-cols-[1fr_1fr_1.5fr] gap-4 items-center p-2 rounded-2xl hover:bg-gray-50 transition-colors group"
                >
                  <div className="flex items-center gap-2 font-semibold text-gray-700">
                    <span className="text-gray-400 text-sm font-normal">₹</span>
                    {den}
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      value={qty === 0 ? '' : qty}
                      onChange={(e) => handleNoteChange(den, e.target.value)}
                      placeholder="0"
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2.5 px-3 text-center text-gray-900 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 focus:bg-white transition-all placeholder:text-gray-300"
                    />
                  </div>
                  <div className="text-right font-mono font-medium text-gray-500 group-hover:text-gray-900 transition-colors">
                    {amount > 0 ? formatIndianNumber(amount) : '-'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Summary & Submit */}
        <div className="md:col-span-5 space-y-6">
          <div className="bg-white rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.04)] p-6 md:p-8 sticky top-8 border border-gray-100">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Summary</h2>
            
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <IndianRupee size={16} />
                  <span className="text-sm font-medium">Calculated Cash</span>
                </div>
                <div className={`text-4xl font-bold tracking-tight break-words ${totalAmount === Number(expectedCOD) ? 'text-green-600' : 'text-gray-900'}`}>
                  {formatIndianNumber(totalAmount)}
                </div>
              </div>

              <div className="h-px bg-gray-100 w-full"></div>

              <div>
                <div className="flex items-center gap-2 text-gray-500 mb-1">
                  <Wallet size={16} />
                  <span className="text-sm font-medium">Total Notes</span>
                </div>
                <div className="text-2xl font-semibold tracking-tight text-gray-700">
                  {new Intl.NumberFormat('en-IN').format(totalNotes)}
                </div>
              </div>
            </div>

            <button 
              onClick={handleSubmit}
              className={`w-full mt-8 py-4 rounded-2xl font-bold text-white transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 ${
                totalAmount === Number(expectedCOD) 
                  ? 'bg-green-600 hover:bg-green-700 shadow-green-600/20' 
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
              }`}
            >
              {totalAmount === Number(expectedCOD) ? (
                <>
                  <CheckCircle2 size={20} />
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
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
        <div className="bg-white rounded-[2rem] p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={32} />
          </div>
          <h3 className="text-2xl font-bold text-center text-gray-900 mb-2">Amount Mismatch</h3>
          
          <div className="bg-gray-50 rounded-2xl p-4 mb-6 space-y-2 border border-gray-100">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Expected COD:</span>
              <span className="font-medium text-gray-900">{formatIndianNumber(Number(expectedCOD))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Calculated Cash:</span>
              <span className="font-medium text-gray-900">{formatIndianNumber(totalAmount)}</span>
            </div>
            <div className="h-px bg-gray-200 w-full my-2"></div>
            <div className="flex justify-between text-base font-bold">
              <span className="text-gray-900">Difference:</span>
              <span className="text-amber-600">{formatIndianNumber(absDiff)}</span>
            </div>
          </div>

          <p className="text-sm font-semibold text-gray-700 mb-4 text-center">
            How should we record the remaining {formatIndianNumber(absDiff)}?
          </p>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <button 
              onClick={() => saveDeposit(diff, 0)} 
              className="py-4 rounded-2xl font-semibold border-2 border-blue-100 text-blue-700 bg-white hover:bg-blue-50 hover:border-blue-200 flex flex-col items-center gap-2 transition-all active:scale-95"
            >
              <CreditCard size={24} />
              Online
            </button>
            <button 
              onClick={() => saveDeposit(0, diff)} 
              className="py-4 rounded-2xl font-semibold border-2 border-orange-100 text-orange-700 bg-white hover:bg-orange-50 hover:border-orange-200 flex flex-col items-center gap-2 transition-all active:scale-95"
            >
              <Clock size={24} />
              Due
            </button>
          </div>
          
          <button 
            onClick={() => setShowModal(false)} 
            className="w-full py-3.5 rounded-2xl font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Cancel & Recalculate
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 font-sans p-4 md:p-8 flex justify-center items-start">
      {view === 'dashboard' && renderDashboard()}
      {view === 'enter_cod' && renderEnterCOD()}
      {view === 'calculator' && renderCalculator()}
      {renderModal()}
    </div>
  );
}
