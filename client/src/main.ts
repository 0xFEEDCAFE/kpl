import '@fontsource/poppins/200.css'
import '@fontsource/poppins/300.css'
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import 'balloon-css/balloon.min.css'
import './app.css'
import App from './App.svelte'

const path = window.location.pathname;

if (path.startsWith('/room/')) {
  window.location.pathname = path.replace('/room/', '/join/');
  throw new Error('REDIRECT');
}

const allowedPaths = [
  '/',
  '/rules',
  '/auth/callback/discord',
  '/auth/callback/google',
];

if (!path.startsWith('/join/') && !allowedPaths.includes(path)) {
  window.location.pathname = '/';
  throw new Error('REDIRECT');
}

const app = new App({
  target: document.getElementById('app')!,
})

export default app
