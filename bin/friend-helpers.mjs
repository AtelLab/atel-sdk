// ─── Friend System Data Layer ────────────────────────────────────
// Helper functions for P2P friend system data management

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ATEL_DIR = resolve(process.env.ATEL_DIR || '.atel');

// Ensure .atel directory exists
function ensureDir() { 
  if (!existsSync(ATEL_DIR)) {
    mkdirSync(ATEL_DIR, { recursive: true });
  }
}

// Log helper (reuse from main)
function log(event) {
  ensureDir();
  const INBOX_FILE = resolve(ATEL_DIR, 'inbox.jsonl');
  appendFileSync(INBOX_FILE, JSON.stringify(event) + '\n');
  try {
    console.log(JSON.stringify(event));
  } catch (e) {
    if (e.code === 'EPIPE') return;
    throw e;
  }
}

// ─── 1. Friends Management ───────────────────────────────────────

// Load friends from .atel/friends.json
export function loadFriends() {
  const path = join(ATEL_DIR, 'friends.json');
  if (!existsSync(path)) return { friends: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { friends: [] };
  }
}

// Save friends to .atel/friends.json
export function saveFriends(data) {
  ensureDir();
  writeFileSync(join(ATEL_DIR, 'friends.json'), JSON.stringify(data, null, 2));
}

// Check if DID is a friend
export function isFriend(did) {
  const friends = loadFriends();
  return friends.friends.some(f => f.did === did);
}

// Add friend (idempotent)
export function addFriend(did, options = {}) {
  const friends = loadFriends();
  
  // Idempotency check
  if (friends.friends.some(f => f.did === did)) {
    return false; // Already exists
  }
  
  friends.friends.push({
    did,
    alias: options.alias || '',
    addedAt: new Date().toISOString(),
    addedBy: options.addedBy || 'manual',
    notes: options.notes || ''
  });
  
  saveFriends(friends);
  log({ event: 'friend_added', did, addedBy: options.addedBy });
  return true;
}

// Remove friend
export function removeFriend(did) {
  const friends = loadFriends();
  const before = friends.friends.length;
  friends.friends = friends.friends.filter(f => f.did !== did);
  const removed = before > friends.friends.length;
  
  if (removed) {
    saveFriends(friends);
    log({ event: 'friend_removed', did });
  }
  
  return removed;
}

// ─── 2. Friend Requests Management ───────────────────────────────

// Load friend requests from .atel/friend-requests.json
export function loadFriendRequests() {
  const path = join(ATEL_DIR, 'friend-requests.json');
  if (!existsSync(path)) return { incoming: [], outgoing: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { incoming: [], outgoing: [] };
  }
}

// Save friend requests
export function saveFriendRequests(data) {
  ensureDir();
  writeFileSync(join(ATEL_DIR, 'friend-requests.json'), JSON.stringify(data, null, 2));
}

// ─── 3. Temporary Sessions Management ────────────────────────────

// Load temp sessions from .atel/temp-sessions.json
export function loadTempSessions() {
  const path = join(ATEL_DIR, 'temp-sessions.json');
  if (!existsSync(path)) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { sessions: [] };
  }
}

// Save temp sessions
export function saveTempSessions(data) {
  ensureDir();
  writeFileSync(join(ATEL_DIR, 'temp-sessions.json'), JSON.stringify(data, null, 2));
}

// Get active temp session for DID
export function getActiveTempSession(did) {
  const sessions = loadTempSessions();
  const now = Date.now();
  
  return sessions.sessions.find(s => 
    s.did === did && 
    new Date(s.expiresAt).getTime() > now
  );
}

// Add temp session
export function addTempSession(did, options = {}) {
  const sessions = loadTempSessions();
  
  const sessionId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const durationMinutes = options.durationMinutes || 60;
  const maxTasks = options.maxTasks || 10;
  
  sessions.sessions.push({
    sessionId,
    did,
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + durationMinutes * 60000).toISOString(),
    reason: options.reason || '',
    taskCount: 0,
    maxTasks
  });
  
  saveTempSessions(sessions);
  log({ event: 'temp_session_granted', did, sessionId, durationMinutes, maxTasks });
  
  return sessionId;
}

// Remove temp session
export function removeTempSession(sessionId) {
  const sessions = loadTempSessions();
  const before = sessions.sessions.length;
  sessions.sessions = sessions.sessions.filter(s => s.sessionId !== sessionId);
  const removed = before > sessions.sessions.length;
  
  if (removed) {
    saveTempSessions(sessions);
    log({ event: 'temp_session_removed', sessionId });
  }
  
  return removed;
}

// Increment temp session task count
export function incrementTempSessionTaskCount(sessionId) {
  const sessions = loadTempSessions();
  const session = sessions.sessions.find(s => s.sessionId === sessionId);
  if (session) {
    session.taskCount++;
    saveTempSessions(sessions);
    return true;
  }
  return false;
}

// Clean expired temp sessions
export function cleanExpiredTempSessions() {
  const sessions = loadTempSessions();
  const now = Date.now();
  const before = sessions.sessions.length;
  
  sessions.sessions = sessions.sessions.filter(s => 
    new Date(s.expiresAt).getTime() > now
  );
  
  const removed = before - sessions.sessions.length;
  if (removed > 0) {
    saveTempSessions(sessions);
    log({ event: 'temp_sessions_cleaned', count: removed });
  }
  
  return removed;
}

// ─── 4. Relationship Policy ──────────────────────────────────────

// Get default relationship policy
export function getDefaultRelationshipPolicy() {
  return {
    defaultMode: 'friends_only',
    allowTemporarySessions: true,
    temporarySessionRequiresConfirm: false,
    temporarySessionTTLMinutes: 60,
    temporarySessionMaxTasks: 10,
    autoAcceptFriendRequests: false,
    friendRequestRequiresMessage: false
  };
}
