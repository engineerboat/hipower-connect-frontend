import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

console.log("MAIN.JSX LOADED");

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <App />
);