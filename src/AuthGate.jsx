import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import Login from './Login.jsx';

function AuthGate({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [checkingLogin, setCheckingLogin] = useState(true);

  useEffect(() => {
    // Firebase calls this function once immediately (with whoever's
    // already logged in, or null), and again every time someone logs
    // in or out - so this one listener handles the whole app's state.
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      setUser(loggedInUser);

      if (loggedInUser) {
        // Every user gets a profile document the first time they log
        // in, storing their email (so others can find them to share a
        // project) and a role. New accounts default to "surveyor" - a
        // normal working role, not an elevated one. Promoting someone
        // to project_manager or admin is done directly in the Firestore
        // console for now; there's no in-app "make me admin" button,
        // since a client-side control like that couldn't be trusted.
        const userDocRef = doc(db, 'users', loggedInUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (!userDocSnap.exists()) {
          const newProfile = {
            email: loggedInUser.email,
            role: 'surveyor',
            createdAt: new Date().toISOString()
          };
          await setDoc(userDocRef, newProfile);
          setRole(newProfile.role);
        } else {
          setRole(userDocSnap.data().role);
        }
      } else {
        setRole(null);
      }

      setCheckingLogin(false);
    });

    // Cleanup: stop listening if this component ever unmounts.
    return () => unsubscribe();
  }, []);

  // Made available globally so the legacy app (a plain JS class, not a
  // React component) can check the current user's role too - e.g. to
  // hide the Save button for a Viewer.
  useEffect(() => {
    window.currentUserRole = role;
  }, [role]);

  if (checkingLogin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <>
      <div style={logoutBarStyle}>
        <span style={{ marginRight: '10px' }}>{user.email}</span>
        <span style={roleBadgeStyle}>{role}</span>
        <button onClick={() => signOut(auth)} style={logoutButtonStyle}>Log out</button>
      </div>
      {children}
    </>
  );
}

const logoutBarStyle = {
  position: 'fixed',
  top: 0,
  right: 0,
  background: 'rgba(0,0,0,0.75)',
  color: 'white',
  padding: '8px 14px',
  fontSize: '12.5px',
  zIndex: 10000,
  borderBottomLeftRadius: '8px',
  display: 'flex',
  alignItems: 'center'
};

const roleBadgeStyle = {
  background: 'rgba(255,255,255,0.2)',
  padding: '2px 8px',
  borderRadius: '10px',
  fontSize: '11px',
  marginRight: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.03em'
};

const logoutButtonStyle = {
  background: '#dc3545',
  color: 'white',
  border: 'none',
  padding: '5px 10px',
  borderRadius: '4px',
  fontSize: '12px',
  cursor: 'pointer'
};

export default AuthGate;
