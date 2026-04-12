import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    let message = error.message;
    try {
      // Try to parse the JSON error thrown by handleFirestoreError
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.error) {
        message = parsed.error;
        
        // Make common Firestore errors more user-friendly
        if (message.includes('Missing or insufficient permissions')) {
          message = "You don't have permission to perform this action. Please check your access rights.";
        } else if (message.includes('Quota exceeded')) {
          message = "The database quota has been exceeded. Please try again later.";
        } else if (message.includes('offline')) {
          message = "You appear to be offline. Please check your internet connection.";
        }
      }
    } catch (e) {
      // If it's not JSON, just use the original message
    }
    return { hasError: true, errorMessage: message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4 font-sans text-gray-900">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-red-100">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-6 bg-red-50 p-4 rounded-xl text-sm break-words">
              {this.state.errorMessage || "An unexpected error occurred."}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 text-white px-6 py-4 rounded-2xl font-semibold hover:bg-red-700 flex items-center justify-center gap-2 shadow-lg shadow-red-600/20 transition-all active:scale-95"
            >
              <RefreshCw size={20} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
