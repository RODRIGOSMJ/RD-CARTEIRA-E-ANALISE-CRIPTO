import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export const firebaseProjectId = firebaseConfig.projectId;
export const firebaseAuthDomainsSettingsUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;

export function isUnauthorizedDomainError(err: unknown): boolean {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  const msg = err instanceof Error ? err.message : String(err);
  return code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain');
}

export function formatFriendlyFirestoreError(err: unknown): string {
  const code = typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code?: unknown }).code ?? '')
    : '';
  const raw = err instanceof Error ? err.message : String(err);
  let msg = raw;
  try {
    const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
    if (parsed?.error) msg = parsed.error;
  } catch {
    // not JSON
  }

  if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'este domínio';
    return `Domínio publicado (${host}) ainda não autorizado no Firebase Auth. Adicione "${host}" em Authentication > Settings > Authorized domains no Console do Firebase.`;
  }
  if (code === 'auth/popup-blocked' || msg.includes('auth/popup-blocked')) {
    return 'O navegador bloqueou a janela de login do Google. Permita pop-ups para este site e tente novamente.';
  }
  if (code === 'auth/network-request-failed' || msg.includes('auth/network-request-failed')) {
    return 'Falha de rede ao conectar com o login do Google. Verifique sua conexão e tente novamente.';
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('auth/operation-not-allowed')) {
    return 'O provedor Google não está ativado no Firebase Authentication deste projeto.';
  }
  if (msg.includes('Quota exceeded')) {
    if (msg.includes('Free daily read units per project')) {
      return `Limite diário gratuito do Firestore atingido. O limite reinicia amanhã ou pode ser acompanhado no console: https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
    }
    return 'Cota diária do banco em nuvem excedida. O limite reinicia no próximo dia.';
  }
  if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('insufficient')) {
    return 'Permissão insuficiente na nuvem. Verifique se entrou com uma conta Google verificada.';
  }
  if (msg.toLowerCase().includes('offline')) {
    return 'Sem conexão com o servidor em nuvem no momento. Tente novamente em instantes.';
  }
  return msg || 'Erro na sincronização em nuvem.';
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}

export async function signOutCloud(): Promise<void> {
  await signOut(auth);
}

export { onAuthStateChanged, type User };
