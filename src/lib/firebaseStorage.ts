import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  getBlob,
  listAll,
  getMetadata
} from 'firebase/storage';
import { storage } from '../firebase';
import { StoredProposalFile } from '../types';

const sanitizeSlug = (value: string, fallback = 'arquivo'): string => {
  const cleaned = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
};

export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const buildProposalStorageKey = (
  proposalId?: string,
  empreendimento?: string,
  unidade?: string,
  cliente?: string
): string => {
  if (proposalId && /^[a-zA-Z0-9_-]+$/.test(proposalId)) {
    return proposalId;
  }
  const parts = [
    sanitizeSlug(empreendimento || 'proposta', 'proposta'),
    unidade ? sanitizeSlug(`un_${unidade}`, '') : '',
    cliente ? sanitizeSlug(cliente.split(' ')[0] || '', '') : ''
  ].filter(Boolean);
  return `${parts.join('_')}_${Date.now()}`;
};

export const mapFirebaseStorageError = (err: any): string => {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');

  if (code === 'storage/unauthorized' || msg.includes('storage/unauthorized')) {
    return 'Permissão negada no Firebase Storage. Verifique se as regras (storage.rules) foram publicadas no Firebase Console e se você está autenticado.';
  }
  if (code === 'storage/bucket-not-found' || msg.includes('bucket-not-found')) {
    return 'Bucket do Firebase Storage não encontrado ou ainda não ativado no Firebase Console (Build > Storage).';
  }
  if (code === 'storage/quota-exceeded') {
    return 'Cota do Firebase Storage excedida.';
  }
  if (code === 'storage/canceled') {
    return 'Upload cancelado.';
  }
  if (code === 'storage/retry-limit-exceeded') {
    return 'Tempo limite excedido ao enviar para o Firebase Storage. Verifique sua conexão ou configuração de CORS do bucket.';
  }
  if (msg.toLowerCase().includes('cors') || msg.toLowerCase().includes('network')) {
    return 'Erro de rede ou CORS ao acessar o Firebase Storage. Verifique as regras e o CORS do bucket no Firebase Console.';
  }
  return msg || 'Erro desconhecido ao acessar o Firebase Storage.';
};

export interface UploadProposalFileParams {
  proposalKey: string;
  ownerUid: string;
  docId?: string;
  docType: string;
  file: File;
  onProgress?: (percent: number) => void;
}

export const uploadProposalFileToStorage = async ({
  proposalKey,
  ownerUid,
  docId,
  docType,
  file,
  onProgress
}: UploadProposalFileParams): Promise<StoredProposalFile> => {
  if (!ownerUid) {
    throw new Error('Usuário não autenticado para envio ao Firebase Storage.');
  }
  const safeKey = sanitizeSlug(proposalKey, `prop_${Date.now()}`);
  const safeType = sanitizeSlug(docType, 'documento');
  const safeName = sanitizeSlug(file.name, 'arquivo');
  const fileId = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const storagePath = `propostas/${ownerUid}/${safeKey}/${fileId}_${safeType}_${safeName}`;
  const storageRef = ref(storage, storagePath);

  const metadata = {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      uid: ownerUid,
      proposalKey: safeKey,
      docId: docId || '',
      docType: docType || 'Documento',
      originalName: file.name
    }
  };

  return new Promise<StoredProposalFile>((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);
    let settled = false;
    const STALL_TIMEOUT_MS = 20000;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStallTimer = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    const resetStallTimer = () => {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          uploadTask.cancel();
        } catch {
          // ignore cancel error
        }
        reject(new Error('Tempo limite excedido ao enviar arquivo para o Firebase Storage. Verifique a conexão ou configuração do bucket.'));
      }, STALL_TIMEOUT_MS);
    };

    resetStallTimer();

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        resetStallTimer();
        if (onProgress && snapshot.totalBytes > 0) {
          const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          onProgress(pct);
        }
      },
      (error) => {
        clearStallTimer();
        if (settled) return;
        settled = true;
        reject(new Error(mapFirebaseStorageError(error)));
      },
      async () => {
        clearStallTimer();
        if (settled) return;
        settled = true;
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          resolve({
            id: fileId,
            docId,
            docType: docType || 'Documento',
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            storagePath,
            downloadUrl,
            uploadedAt: new Date().toISOString(),
            uploadedByUid: ownerUid
          });
        } catch (err: any) {
          reject(new Error(mapFirebaseStorageError(err)));
        }
      }
    );
  });
};

export interface UploadProposalBlobParams {
  proposalKey: string;
  ownerUid: string;
  docType: string;
  fileName: string;
  blob: Blob;
  onProgress?: (percent: number) => void;
}

export const uploadProposalBlobToStorage = async ({
  proposalKey,
  ownerUid,
  docType,
  fileName,
  blob,
  onProgress
}: UploadProposalBlobParams): Promise<StoredProposalFile> => {
  const file = new File([blob], fileName, {
    type: blob.type || 'application/pdf'
  });
  return uploadProposalFileToStorage({
    proposalKey,
    ownerUid,
    docId: sanitizeSlug(docType, 'gerado').toLowerCase(),
    docType,
    file,
    onProgress
  });
};

export const deleteProposalFileFromStorage = async (storagePath: string): Promise<void> => {
  if (!storagePath) return;
  try {
    const fileRef = ref(storage, storagePath);
    await deleteObject(fileRef);
  } catch (err: any) {
    if (err?.code === 'storage/object-not-found') {
      return;
    }
    throw new Error(mapFirebaseStorageError(err));
  }
};

export const fetchStorageFileAsFile = async (storedFile: StoredProposalFile): Promise<File> => {
  try {
    if (storedFile.storagePath) {
      const fileRef = ref(storage, storedFile.storagePath);
      const blob = await getBlob(fileRef);
      return new File([blob], storedFile.fileName, {
        type: storedFile.contentType || blob.type || 'application/octet-stream'
      });
    }
  } catch (sdkErr) {
    console.warn('[Storage] getBlob fallback to downloadUrl:', sdkErr);
  }

  const res = await fetch(storedFile.downloadUrl);
  if (!res.ok) {
    throw new Error(`Falha ao baixar arquivo do Firebase Storage (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], storedFile.fileName, {
    type: storedFile.contentType || blob.type || 'application/octet-stream'
  });
};

export const listProposalFolderFiles = async (
  ownerUid: string,
  proposalKey: string
): Promise<Array<{ name: string; fullPath: string; downloadUrl: string; size?: number; contentType?: string }>> => {
  const folderRef = ref(storage, `propostas/${ownerUid}/${sanitizeSlug(proposalKey)}`);
  const listRes = await listAll(folderRef);
  const items = await Promise.all(
    listRes.items.map(async (itemRef) => {
      const [downloadUrl, meta] = await Promise.all([
        getDownloadURL(itemRef),
        getMetadata(itemRef).catch(() => null)
      ]);
      return {
        name: meta?.customMetadata?.originalName || itemRef.name,
        fullPath: itemRef.fullPath,
        downloadUrl,
        size: meta?.size,
        contentType: meta?.contentType
      };
    })
  );
  return items;
};
