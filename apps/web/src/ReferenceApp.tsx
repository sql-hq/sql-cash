import { App } from './App';
import { WalletProvider } from './components/WalletConnection';

export default function ReferenceApp() { return <WalletProvider><App /></WalletProvider>; }
