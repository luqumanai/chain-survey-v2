import { useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { auth } from './firebase.js';

function Login() {
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isCreatingAccount) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // No need to do anything else here - AuthGate is watching for
      // this and will automatically switch to the app once it succeeds.
    } catch (err) {
      // Firebase's raw error codes look like "auth/wrong-password" -
      // translate the common ones into something a real person reads.
      const messages = {
        'auth/invalid-email': 'That email address doesn\'t look right.',
        'auth/user-not-found': 'No account exists with that email yet.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Email or password is incorrect.',
        'auth/email-already-in-use': 'An account already exists with that email.',
        'auth/weak-password': 'Password should be at least 6 characters.'
      };
      setError(messages[err.code] || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h2 style={styles.title}>🗺️ Chain Survey to GIS Converter</h2>
        <p style={styles.subtitle}>
          {isCreatingAccount ? 'Create an account' : 'Sign in to continue'}
        </p>

        <label style={styles.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
          required
        />

        <label style={styles.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
          minLength={6}
        />

        {error && <p style={styles.error}>{error}</p>}

        <button type="submit" style={styles.button} disabled={submitting}>
          {submitting ? 'Please wait...' : isCreatingAccount ? 'Create Account' : 'Sign In'}
        </button>

        <button
          type="button"
          style={styles.switchButton}
          onClick={() => { setIsCreatingAccount(!isCreatingAccount); setError(''); }}
        >
          {isCreatingAccount
            ? 'Already have an account? Sign in'
            : "Don't have an account? Create one"}
        </button>
      </form>
    </div>
  );
}

// Plain inline styles - this screen exists outside your original app's
// CSS file, so it doesn't rely on legacy-chain-survey.css at all.
const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
  },
  card: {
    background: 'white',
    padding: '36px',
    borderRadius: '10px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    width: '360px'
  },
  title: { color: '#2c5aa0', fontSize: '20px', margin: '0 0 4px', textAlign: 'center' },
  subtitle: { color: '#666', fontSize: '13px', margin: '0 0 20px', textAlign: 'center' },
  label: { display: 'block', fontSize: '13px', fontWeight: 600, color: '#333', margin: '10px 0 5px' },
  input: {
    width: '100%', padding: '10px', border: '2px solid #e9ecef',
    borderRadius: '5px', fontSize: '14px', boxSizing: 'border-box'
  },
  error: { color: '#dc3545', fontSize: '13px', margin: '10px 0 0' },
  button: {
    width: '100%', marginTop: '18px', padding: '11px', background: '#4a69bd',
    color: 'white', border: 'none', borderRadius: '5px', fontSize: '14px',
    fontWeight: 600, cursor: 'pointer'
  },
  switchButton: {
    width: '100%', marginTop: '10px', padding: '8px', background: 'none',
    color: '#4a69bd', border: 'none', fontSize: '12.5px', cursor: 'pointer',
    textDecoration: 'underline'
  }
};

export default Login;
