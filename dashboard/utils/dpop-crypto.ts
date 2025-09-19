/**
 * DPoP Crypto Utilities for Web Embed Authentication
 * Handles keypair generation, storage, and cryptographic operations
 */

const DB_NAME = "hay-dpop-keys";
const DB_VERSION = 1;
const STORE_NAME = "keypairs";

export interface StoredKeypair {
  conversationId: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
  createdAt: Date;
}

/**
 * Generate a new ECDSA P-256 keypair for DPoP authentication
 */
export async function generateKeypair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}> {
  // Generate ECDSA P-256 keypair
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false, // Not extractable by default for security
    ["sign", "verify"]
  );

  // Export public key as JWK for registration
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  // Ensure the JWK has the required fields
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicJwk,
  };
}

/**
 * Open or create the IndexedDB database for storing keypairs
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "conversationId" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

/**
 * Store a keypair in IndexedDB for a specific conversation
 */
export async function storeKeypair(
  conversationId: string,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  publicJwk: JsonWebKey
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const data: StoredKeypair = {
      conversationId,
      privateKey,
      publicKey,
      publicJwk,
      createdAt: new Date(),
    };

    const request = store.put(data);

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(new Error("Failed to store keypair"));
    };
  });
}

/**
 * Retrieve a stored keypair for a conversation
 */
export async function getKeypair(conversationId: string): Promise<StoredKeypair | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(conversationId);

    request.onsuccess = () => {
      db.close();
      resolve(request.result || null);
    };

    request.onerror = () => {
      db.close();
      reject(new Error("Failed to retrieve keypair"));
    };
  });
}

/**
 * Delete a stored keypair for a conversation
 */
export async function deleteKeypair(conversationId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(conversationId);

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(new Error("Failed to delete keypair"));
    };
  });
}

/**
 * Clear all stored keypairs (for cleanup/reset)
 */
export async function clearAllKeypairs(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(new Error("Failed to clear keypairs"));
    };
  });
}

/**
 * Sign data with the private key
 */
export async function signData(
  privateKey: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  return crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256",
    },
    privateKey,
    data
  );
}

/**
 * Convert ArrayBuffer to base64url string
 */
export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Convert string to ArrayBuffer
 */
export function stringToArrayBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str).buffer;
}

/**
 * Generate a random JTI (JWT ID) for replay protection
 */
export function generateJTI(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Check if WebCrypto API is available
 */
export function isWebCryptoAvailable(): boolean {
  return !!(
    window.crypto &&
    window.crypto.subtle &&
    window.indexedDB
  );
}

/**
 * Export a keypair for recovery/backup (makes keys extractable temporarily)
 */
export async function exportKeypairForBackup(conversationId: string): Promise<{
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
} | null> {
  const stored = await getKeypair(conversationId);
  if (!stored) return null;

  try {
    // Note: This will only work if the keys were generated as extractable
    // For production, you might want to implement a different backup strategy
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", stored.privateKey);
    const publicKeyJwk = await crypto.subtle.exportKey("jwk", stored.publicKey);

    return {
      privateKeyJwk,
      publicKeyJwk,
    };
  } catch (error) {
    console.error("Failed to export keypair for backup:", error);
    return null;
  }
}

/**
 * Import a keypair from backup
 */
export async function importKeypairFromBackup(
  conversationId: string,
  privateKeyJwk: JsonWebKey,
  publicKeyJwk: JsonWebKey
): Promise<void> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"]
  );

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyJwk,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["verify"]
  );

  await storeKeypair(conversationId, privateKey, publicKey, publicKeyJwk);
}