import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, ROUNDS);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
