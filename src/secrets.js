// Encrypts secrets we must store, like sellers' payout settings, with
// AES-256-GCM. The key comes from SECRET_KEY, which never lives in the database.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const secretsEnabled = () => (process.env.SECRET_KEY || "").length >= 32;

function key() {
  if (!secretsEnabled()) throw new Error("SECRET_KEY must be set to at least 32 characters.");
  return createHash("sha256").update(process.env.SECRET_KEY).digest();
}

export function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
}

export function decrypt(payload) {
  const [version, iv, tag, data] = String(payload).split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
