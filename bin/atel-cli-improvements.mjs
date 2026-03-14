// ═══════════════════════════════════════════════════════════════════
// ATEL CLI UX Improvements - Helper Functions
// ═══════════════════════════════════════════════════════════════════

// ─── 1. Help Functions ───────────────────────────────────────────

export function showFriendHelp() {
  console.log(`
Friend Management Commands:

  atel friend add <did> [options]
    Add a DID as friend
    
    Arguments:
      <did>             DID to add (format: did:atel:ed25519:<public-key>)
    
    Options:
      --alias <name>    Friendly name for this friend
      --notes <text>    Notes about this friend
      --json            Output in JSON format
    
    Examples:
      atel friend add did:atel:ed25519:abc123 --alias "Alice"
      atel friend add did:atel:ed25519:abc123 --alias "Bob" --notes "Met at conference"

  atel friend remove <did> [options]
    Remove a friend
    
    Arguments:
      <did>             DID to remove
    
    Options:
      --yes             Skip confirmation prompt
      --json            Output in JSON format
    
    Examples:
      atel friend remove did:atel:ed25519:abc123
      atel friend remove did:atel:ed25519:abc123 --yes

  atel friend list [options]
    List all friends
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel friend list
      atel friend list --json

  atel friend request <did> [options]
    Send a friend request
    
    Arguments:
      <did>             Target DID
    
    Options:
      --message <text>  Message to include with request
      --json            Output in JSON format
    
    Examples:
      atel friend request did:atel:ed25519:abc123
      atel friend request did:atel:ed25519:abc123 --message "Hi, let's connect!"

  atel friend accept <requestId> [options]
    Accept a friend request
    
    Arguments:
      <requestId>       Request ID to accept
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel friend accept freq_1234567890_abc123

  atel friend reject <requestId> [options]
    Reject a friend request
    
    Arguments:
      <requestId>       Request ID to reject
    
    Options:
      --reason <text>   Reason for rejection
      --json            Output in JSON format
    
    Examples:
      atel friend reject freq_1234567890_abc123
      atel friend reject freq_1234567890_abc123 --reason "Don't know you"

  atel friend pending [options]
    List pending friend requests
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel friend pending

  atel friend status [options]
    Show friend system status
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel friend status

For more information, visit: https://docs.atel.io/friend-system
  `);
}

export function showTempSessionHelp() {
  console.log(`
Temporary Session Management:

  atel temp-session allow <did> [options]
    Grant temporary access to a DID
    
    Arguments:
      <did>                   DID to grant access
    
    Options:
      --duration <minutes>    Duration in minutes (default: 60, max: 1440)
      --max-tasks <count>     Maximum number of tasks (default: 10, max: 100)
      --reason <text>         Reason for granting access
      --json                  Output in JSON format
    
    Common durations:
      --duration 60           1 hour
      --duration 1440         1 day
      --duration 10080        1 week
    
    Examples:
      atel temp-session allow did:atel:ed25519:abc123
      atel temp-session allow did:atel:ed25519:abc123 --duration 120 --max-tasks 5
      atel temp-session allow did:atel:ed25519:abc123 --duration 1440 --reason "One-time collaboration"

  atel temp-session revoke <sessionId> [options]
    Revoke a temporary session
    
    Arguments:
      <sessionId>       Session ID to revoke
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel temp-session revoke temp_1234567890_abc123

  atel temp-session list [options]
    List temporary sessions
    
    Options:
      --json            Output in JSON format
      --all             Include expired sessions
    
    Examples:
      atel temp-session list
      atel temp-session list --all

  atel temp-session clean [options]
    Remove expired sessions
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel temp-session clean

  atel temp-session status [options]
    Show temporary session status
    
    Options:
      --json            Output in JSON format
    
    Examples:
      atel temp-session status

For more information, visit: https://docs.atel.io/friend-system
  `);
}

// ─── 2. Unified Output Format ────────────────────────────────────

export function formatOutput(data, options = {}) {
  const format = options.json ? 'json' : (options.quiet ? 'quiet' : 'human');
  
  if (format === 'json') {
    console.log(JSON.stringify(data));
    return;
  }
  
  if (format === 'quiet') {
    // Only output essential info
    if (data.id) console.log(data.id);
    else if (data.did) console.log(data.did);
    else if (data.sessionId) console.log(data.sessionId);
    else if (data.requestId) console.log(data.requestId);
    else console.log(data.message || 'ok');
    return;
  }
  
  // Human-readable format
  if (data.status === 'ok' || data.success) {
    console.log(`✓ ${data.message || 'Success'}`);
    if (data.did) console.log(`  DID: ${data.did}`);
    if (data.alias) console.log(`  Alias: ${data.alias}`);
    if (data.sessionId) console.log(`  Session ID: ${data.sessionId}`);
    if (data.requestId) console.log(`  Request ID: ${data.requestId}`);
    if (data.addedAt) console.log(`  Added: ${new Date(data.addedAt).toLocaleString()}`);
    if (data.expiresAt) console.log(`  Expires: ${new Date(data.expiresAt).toLocaleString()}`);
  } else if (data.status === 'error' || data.error) {
    console.error(`✗ ${data.message || data.error || 'Error'}`);
    if (data.hint) console.error(`  Hint: ${data.hint}`);
  } else {
    // Neutral message
    console.log(data.message || JSON.stringify(data));
  }
}

// ─── 3. Confirmation Prompts ─────────────────────────────────────

export function confirm(message, defaultValue = false) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    rl.question(`${message} (${defaultText}): `, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

// ─── 4. Status Commands ──────────────────────────────────────────

export async function cmdFriendStatus(args, loadFriends, loadFriendRequests, loadTempSessions, loadPolicy) {
  const friends = loadFriends();
  const requests = loadFriendRequests();
  const tempSessions = loadTempSessions();
  const policy = loadPolicy();
  
  const relPolicy = policy.relationshipPolicy || {};
  const defaultMode = relPolicy.defaultMode || 'open';
  
  const now = Date.now();
  const activeSessions = tempSessions.sessions.filter(s => 
    s.status === 'active' && new Date(s.expiresAt).getTime() > now
  );
  
  const incomingPending = (requests.incoming || []).filter(r => r.status === 'pending');
  const outgoingPending = (requests.outgoing || []).filter(r => r.status === 'pending');
  
  const blockedCount = (policy.blockedDIDs || []).length;
  
  if (args.json) {
    formatOutput({
      mode: defaultMode,
      totalFriends: friends.friends.length,
      pendingRequests: {
        incoming: incomingPending.length,
        outgoing: outgoingPending.length
      },
      temporarySessions: activeSessions.length,
      blockedDIDs: blockedCount
    }, args);
    return;
  }
  
  console.log('\nFriend System Status:');
  console.log(`  Mode: ${defaultMode}`);
  console.log(`  Total friends: ${friends.friends.length}`);
  console.log(`  Pending requests: ${incomingPending.length + outgoingPending.length} (incoming: ${incomingPending.length}, outgoing: ${outgoingPending.length})`);
  console.log(`  Temporary sessions: ${activeSessions.length} active`);
  console.log(`  Blocked DIDs: ${blockedCount}`);
  
  // Recent activity
  if (incomingPending.length > 0 || outgoingPending.length > 0) {
    console.log('\nRecent activity:');
    
    incomingPending.slice(0, 3).forEach(r => {
      const timeAgo = Math.floor((now - new Date(r.receivedAt).getTime()) / 60000);
      console.log(`  - Friend request from ${r.from.slice(0, 20)}... (${timeAgo} minutes ago)`);
    });
    
    outgoingPending.slice(0, 3).forEach(r => {
      const timeAgo = Math.floor((now - new Date(r.sentAt).getTime()) / 60000);
      console.log(`  - You sent a friend request to ${r.to.slice(0, 20)}... (${timeAgo} minutes ago)`);
    });
  }
  
  // Expiring sessions
  const expiringSoon = activeSessions.filter(s => {
    const expiresIn = new Date(s.expiresAt).getTime() - now;
    return expiresIn < 3600000; // < 1 hour
  });
  
  if (expiringSoon.length > 0) {
    console.log('\nExpiring soon:');
    expiringSoon.forEach(s => {
      const expiresIn = Math.floor((new Date(s.expiresAt).getTime() - now) / 60000);
      console.log(`  - Temporary session for ${s.did.slice(0, 20)}... expires in ${expiresIn} minutes`);
    });
  }
  
  console.log('');
}

export async function cmdTempSessionStatus(args, loadTempSessions) {
  const sessions = loadTempSessions();
  const now = Date.now();
  
  const active = sessions.sessions.filter(s => 
    s.status === 'active' && new Date(s.expiresAt).getTime() > now
  );
  
  const expired = sessions.sessions.filter(s => 
    new Date(s.expiresAt).getTime() <= now
  );
  
  if (args.json) {
    formatOutput({
      activeSessions: active.length,
      expiredSessions: expired.length,
      totalGranted: sessions.sessions.length,
      sessions: active.map(s => ({
        sessionId: s.sessionId,
        did: s.did,
        expiresAt: s.expiresAt,
        expiresIn: Math.floor((new Date(s.expiresAt).getTime() - now) / 60000),
        tasks: `${s.taskCount}/${s.maxTasks}`,
        reason: s.notes
      }))
    }, args);
    return;
  }
  
  console.log('\nTemporary Session Status:');
  console.log(`  Active sessions: ${active.length}`);
  console.log(`  Expired sessions: ${expired.length}`);
  console.log(`  Total granted: ${sessions.sessions.length}`);
  
  if (active.length > 0) {
    console.log('\nActive sessions:');
    active.forEach((s, i) => {
      const expiresIn = Math.floor((new Date(s.expiresAt).getTime() - now) / 60000);
      console.log(`  ${i + 1}. DID: ${s.did.slice(0, 30)}...`);
      console.log(`     Expires: ${new Date(s.expiresAt).toLocaleString()} (in ${expiresIn} minutes)`);
      console.log(`     Tasks: ${s.taskCount}/${s.maxTasks}`);
      if (s.notes) console.log(`     Reason: ${s.notes}`);
    });
  }
  
  console.log('');
}

// ─── 5. DID Alias System ─────────────────────────────────────────

export function loadAliases(ALIASES_FILE, existsSync, readFileSync) {
  if (!existsSync(ALIASES_FILE)) {
    return { aliases: {} };
  }
  try {
    return JSON.parse(readFileSync(ALIASES_FILE, 'utf-8'));
  } catch {
    return { aliases: {} };
  }
}

export function saveAliases(data, ALIASES_FILE, ensureDir, writeFileSync) {
  ensureDir();
  writeFileSync(ALIASES_FILE, JSON.stringify(data, null, 2));
}

export function resolveDID(didOrAlias, loadAliasesFn) {
  if (didOrAlias.startsWith('@')) {
    const alias = didOrAlias.slice(1);
    const aliases = loadAliasesFn();
    const did = aliases.aliases[alias];
    if (!did) {
      throw new Error(`Alias not found: @${alias}`);
    }
    return did;
  }
  return didOrAlias;
}

export async function cmdAliasSet(args, validateDID, loadAliasesFn, saveAliasesFn, formatOutput) {
  const alias = args._[0];
  const did = args._[1];
  
  if (!alias || !did) {
    console.error('Usage: atel alias set <alias> <did>');
    process.exit(1);
  }
  
  const validation = validateDID(did);
  if (!validation.valid) {
    formatOutput({ status: 'error', message: `Invalid DID: ${validation.error}` }, args);
    process.exit(1);
  }
  
  const aliases = loadAliasesFn();
  aliases.aliases[alias] = did;
  saveAliasesFn(aliases);
  
  formatOutput({ status: 'ok', message: 'Alias set successfully', alias, did }, args);
}

export async function cmdAliasList(args, loadAliasesFn, formatOutput) {
  const aliases = loadAliasesFn();
  
  if (args.json) {
    formatOutput(aliases.aliases, args);
    return;
  }
  
  const entries = Object.entries(aliases.aliases);
  
  if (entries.length === 0) {
    console.log('No aliases defined.');
    return;
  }
  
  console.log(`\nAliases (${entries.length}):\n`);
  entries.forEach(([alias, did]) => {
    console.log(`  @${alias} → ${did}`);
  });
  console.log('');
}

export async function cmdAliasRemove(args, loadAliasesFn, saveAliasesFn, formatOutput) {
  const alias = args._[0];
  
  if (!alias) {
    console.error('Usage: atel alias remove <alias>');
    process.exit(1);
  }
  
  const aliases = loadAliasesFn();
  
  if (!aliases.aliases[alias]) {
    formatOutput({ status: 'error', message: 'Alias not found' }, args);
    process.exit(1);
  }
  
  delete aliases.aliases[alias];
  saveAliasesFn(aliases);
  
  formatOutput({ status: 'ok', message: 'Alias removed successfully', alias }, args);
}
