// src/pages/LoginPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Lock, User, ArrowLeft, Building, Eye, EyeOff } from 'lucide-react';

// --- PinInput Component ---
const PinInput = ({ pin, setPin, pinLength = 4 }) => {
  const handlePinChange = (e, index) => {
    const { value } = e.target;
    if (/^[0-9]$/.test(value) || value === "") {
      const newPin = [...pin];
      newPin[index] = value;
      setPin(newPin);
      if (value && index < pinLength - 1) {
        e.target.nextSibling?.focus();
      }
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !pin[index] && index > 0) {
      e.target.previousSibling?.focus();
    }
  };

  return (
    <div className="flex justify-center space-x-2 md:space-x-3">
      {Array.from({ length: pinLength }).map((_, index) => (
        <input
          key={index}
          id={`pin-input-${index}`}
          name={`pin-input-${index}`}
          type="password"
          maxLength="1"
          value={pin[index] || ""}
          onChange={(e) => handlePinChange(e, index)}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className="w-14 h-16 text-center text-3xl font-bold bg-slate-100 border-2 border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300"
          autoComplete="off"
        />
      ))}
    </div>
  );
};

// --- UserCard Component ---
const UserCard = ({ user, onSelect, hasStoredPassword }) => (
  <button
    onClick={() => onSelect(user)}
    className="w-full text-left p-4 bg-white border border-slate-200 rounded-xl flex items-center gap-4 hover:border-purple-500 hover:bg-purple-50 hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
  >
    <div className="w-12 h-12 rounded-full bg-purple-100 flex-shrink-0 flex items-center justify-center">
      <User className="w-6 h-6 text-purple-600" />
    </div>
    <div className="flex-1">
      <p className="font-semibold text-lg text-slate-800">{user.name}</p>
      <p className="text-sm text-slate-500">{user.role}</p>
    </div>
    <div className="flex items-center gap-2">
      {hasStoredPassword ? (
        <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded-full">PIN Only</span>
      ) : (
        <span className="text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded-full">Password + PIN</span>
      )}
    </div>
  </button>
);

// --- LoginPage Component ---
const LoginPage = () => {
  const { users, fetchUsers, login, isLoading, error } = useAuthStore();
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [pin, setPin] = useState(new Array(4).fill(''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginStep, setLoginStep] = useState('userSelection'); // 'userSelection', 'password', 'pin'
  const navigate = useNavigate();

  // Get stored passwords from localStorage
  const getStoredPasswords = () => {
    try {
      return JSON.parse(localStorage.getItem('userPasswords') || '{}');
    } catch {
      return {};
    }
  };

  // Save password to localStorage
  const savePassword = (userId, password) => {
    try {
      const storedPasswords = getStoredPasswords();
      storedPasswords[userId] = password;
      localStorage.setItem('userPasswords', JSON.stringify(storedPasswords));
    } catch (error) {
      console.error('Error saving password:', error);
    }
  };

  // Check if user has stored password
  const hasStoredPassword = (userId) => {
    const storedPasswords = getStoredPasswords();
    return !!storedPasswords[userId];
  };

  // Check if user has password in database
  const userHasPassword = (user) => {
    return user && user.password && user.password.trim() !== '';
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleUserSelect = (user) => {
    setSelectedUserId(user._id);
    setPin(new Array(4).fill(''));
    setPassword('');
    
    // Check if user has stored password or needs to set one
    if (hasStoredPassword(user._id)) {
      setLoginStep('pin');
    } else {
      // Always require password setup/entry if not stored
      setLoginStep('password');
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!password.trim()) return;

    const selectedUser = users.find(u => u._id === selectedUserId);
    if (!selectedUser) return;

    // Try to authenticate with password first
    const success = await login(selectedUser.name, password, null);
    if (success) {
      // Save password for future logins
      savePassword(selectedUserId, password);
      navigate('/');
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    const finalPin = pin.join('');
    if (finalPin.length !== 4) return;

    const selectedUser = users.find(u => u._id === selectedUserId);
    if (!selectedUser) return;

    let success = false;

    if (hasStoredPassword(selectedUserId)) {
      // Use stored password for PIN-only login
      const storedPasswords = getStoredPasswords();
      const storedPassword = storedPasswords[selectedUserId];
      success = await login(selectedUser.name, storedPassword, finalPin);
    } else {
      // This shouldn't happen, but fallback to password + PIN
      success = await login(selectedUser.name, password, finalPin);
    }

    if (success) {
      navigate('/');
    }
  };

  const handleBack = () => {
    if (loginStep === 'pin') {
      setLoginStep(hasStoredPassword(selectedUserId) ? 'userSelection' : 'password');
    } else if (loginStep === 'password') {
      setLoginStep('userSelection');
    }
    setPin(new Array(4).fill(''));
    setPassword('');
  };

  const selectedUser = users.find(u => u._id === selectedUserId);

  const renderUserSelection = () => (
    <div className="animate-fade-in w-full">
      <h2 className="text-3xl font-bold text-center text-slate-800">Select User</h2>
      <p className="text-center text-slate-500 mt-2 mb-8">Choose your profile to sign in.</p>
      {isLoading && !users.length && <p className="text-center text-slate-500">Loading Users...</p>}
      {error && <p className="text-center text-red-500 bg-red-100 p-3 rounded-lg">{error}</p>}
      <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-2">
        {users.map((user) => (
          <UserCard 
            key={user._id} 
            user={user} 
            onSelect={handleUserSelect}
            hasStoredPassword={hasStoredPassword(user._id)}
          />
        ))}
      </div>
    </div>
  );

  const renderPasswordScreen = () => {
    const isSettingNewPassword = selectedUser && !userHasPassword(selectedUser);
    
    return (
      <div className="animate-fade-in w-full">
        <button 
          onClick={handleBack} 
          className="absolute top-8 left-8 flex items-center text-sm font-semibold text-slate-600 hover:text-purple-600 transition"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Users
        </button>
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-4xl mb-4">
            {selectedUser?.name?.charAt(0).toUpperCase()}
          </div>
          <h2 className="text-3xl font-bold text-slate-800">Welcome, {selectedUser?.name}!</h2>
          <p className="text-slate-500 mt-2 mb-8">
            {isSettingNewPassword 
              ? "Please create a secure password for your account." 
              : "Please enter your password to continue."
            }
          </p>
        </div>
        <form onSubmit={handlePasswordSubmit}>
          <div className="relative mb-6">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSettingNewPassword ? "Create a secure password" : "Enter your password"}
              className="w-full px-4 py-4 bg-slate-100 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all duration-300 pr-12"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-slate-500 hover:text-purple-600"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          {error && <p className="text-center text-red-500 mb-4 font-medium">{error}</p>}
          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="w-full py-4 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:bg-purple-300 transition-all duration-300 flex items-center justify-center shadow-lg shadow-purple-200 hover:shadow-xl"
          >
            {isLoading ? 'Verifying...' : (isSettingNewPassword ? 'Set Password & Continue' : 'Continue to PIN')}
            <ArrowLeft className="w-5 h-5 ml-2 rotate-180" />
          </button>
        </form>
        <div className="mt-4 text-center">
          <p className="text-xs text-slate-500">
            {isSettingNewPassword 
              ? "This password will be securely saved and required for future logins"
              : "Your password will be securely saved for future PIN-only logins"
            }
          </p>
        </div>
      </div>
    );
  };

  const renderPinScreen = () => (
    <div className="animate-fade-in w-full">
      <button 
        onClick={handleBack} 
        className="absolute top-8 left-8 flex items-center text-sm font-semibold text-slate-600 hover:text-purple-600 transition"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        {hasStoredPassword(selectedUserId) ? 'Back to Users' : 'Back to Password'}
      </button>
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold text-4xl mb-4">
          {selectedUser?.name?.charAt(0).toUpperCase()}
        </div>
        <h2 className="text-3xl font-bold text-slate-800">Welcome back, {selectedUser?.name}!</h2>
        <p className="text-slate-500 mt-2 mb-8">Please enter your 4-digit PIN to continue.</p>
      </div>
      <form onSubmit={handlePinSubmit}>
        <PinInput pin={pin} setPin={setPin} />
        {error && <p className="text-center text-red-500 mt-4 font-medium">{error}</p>}
        <button
          type="submit"
          disabled={isLoading || pin.join('').length !== 4}
          className="w-full mt-8 py-4 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 disabled:bg-purple-300 transition-all duration-300 flex items-center justify-center shadow-lg shadow-purple-200 hover:shadow-xl"
        >
          {isLoading ? 'Verifying...' : 'Login Securely'}
          <Lock className="w-5 h-5 ml-2" />
        </button>
      </form>
      {hasStoredPassword(selectedUserId) && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              // Clear stored password and go back to password entry
              const storedPasswords = getStoredPasswords();
              delete storedPasswords[selectedUserId];
              localStorage.setItem('userPasswords', JSON.stringify(storedPasswords));
              setLoginStep('password');
            }}
            className="text-xs text-purple-600 hover:text-purple-700 underline"
          >
            Use password instead
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row items-center justify-center p-4 font-sans">
      {/* Left Branding Panel */}
      <div className="w-full md:w-1/2 lg:w-2/5 h-full flex-col justify-center items-center text-white p-12 bg-purple-700 hidden md:flex">
        <div className="text-center">
          <Building size={80} className="mx-auto mb-6" />
          <h1 className="text-4xl font-bold tracking-tight">iCreative POS</h1>
          <p className="mt-4 text-lg text-purple-200">The complete Point of Sale solution for your business.</p>
        </div>
        <p className="absolute bottom-8 text-sm text-purple-300">© {new Date().getFullYear()} iCreative. All Rights Reserved.</p>
      </div>

      {/* Right Login Panel */}
      <div className="w-full md:w-1/2 lg:w-3/5 h-full bg-white flex justify-center items-center p-8 relative">
        <div className="w-full max-w-sm">
          {loginStep === 'userSelection' && renderUserSelection()}
          {loginStep === 'password' && renderPasswordScreen()}
          {loginStep === 'pin' && renderPinScreen()}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;