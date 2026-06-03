import { Peer } from "peerjs";

// Helper utilities for ArrayBuffer, Base64, and Hex conversions
function arrayBufferToBase64(buffer) {
  let binary = '';
  let bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  let binaryString = window.atob(base64);
  let len = binaryString.length;
  let bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.peer = null;
    this.connections = new Map(); // peerId -> WebRTC DataConnection
    this.isHost = false;
    this.roomId = null;
    this.myHandle = null; // Username handle e.g. "Bob#4829"
    this.isSinglePlayer = false;

    // Mesh Room Peers tracked by Host
    this.lobbyPeers = []; // list of Peer IDs in room

    // E2EE State mapping: peerId -> sharedAesKey
    this.localKeyPair = null;
    this.sharedKeys = new Map(); // peerId -> CryptoKey (AES-GCM)
    this.sharedKeysHex = new Map(); // peerId -> hex string

    // Friend system state
    this.friends = []; // list of handles (e.g. ["Alice#9920"])
    
    this.initUI();
    this.loadFriends();
  }

  initUI() {
    // Lobby panel references
    this.lobbyOverlay = document.getElementById("lobby-overlay");
    this.lobbyManager = document.getElementById("lobby-manager");
    this.lobbyStatus = document.getElementById("matchmaking-status");
    
    // Config toggles
    this.limitToggleGroup = document.getElementById("limit-toggle-group");
    this.privacyToggleGroup = document.getElementById("privacy-toggle-group");

    // Chat items
    this.chatForm = document.getElementById("chat-form");
    this.txtChatMessage = document.getElementById("txt-chat-message");
    this.chatMessages = document.getElementById("chat-messages");
    this.btnToggleChat = document.getElementById("btn-toggle-chat-size");
    this.chatPanel = document.getElementById("chat-panel");

    // Crypto dashboard
    this.cryptoAesKey = document.getElementById("crypto-aes-key");
    this.cryptoLocalPub = document.getElementById("crypto-local-pub");

    // Connection lights
    this.peerStatusLight = document.getElementById("peer-status-light");
    this.lblConnectionStatus = document.getElementById("lbl-connection-status");

    // Bind lobby triggers
    this.btnToggleChat.addEventListener("click", () => {
      this.chatPanel.classList.toggle("minimized");
      this.btnToggleChat.textContent = this.chatPanel.classList.contains("minimized") ? "[+]" : "[-]";
    });

    this.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.sendChatMessage();
    });
  }

  // Load friends from LocalStorage
  loadFriends() {
    const saved = localStorage.getItem("pg_friends");
    if (saved) {
      try {
        this.friends = JSON.parse(saved);
      } catch (e) {
        this.friends = [];
      }
    }
  }

  saveFriends() {
    localStorage.setItem("pg_friends", JSON.stringify(this.friends));
  }

  addFriend(handle) {
    const trimmed = handle.trim();
    if (!trimmed || !trimmed.includes("#")) return false;
    if (this.friends.includes(trimmed)) return false;
    this.friends.push(trimmed);
    this.saveFriends();
    return true;
  }

  removeFriend(handle) {
    this.friends = this.friends.filter(f => f !== handle);
    this.saveFriends();
  }

  // Generate local ECDH Key Pair
  async generateEcdhKeys() {
    try {
      this.localKeyPair = await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey"]
      );

      const localSpki = await window.crypto.subtle.exportKey("spki", this.localKeyPair.publicKey);
      const b64Key = arrayBufferToBase64(localSpki);
      this.cryptoLocalPub.textContent = this.myHandle || b64Key.substring(0, 12) + "...";
      console.log("ECDH key pair generated.");
      return b64Key;
    } catch (err) {
      console.error("Error generating keys:", err);
    }
  }

  // Setup PeerJS node based on login Nickname
  initPeer(nickname) {
    return new Promise((resolve, reject) => {
      const randCode = Math.floor(1000 + Math.random() * 9000).toString();
      this.myHandle = `${nickname}#${randCode}`;
      
      // Escape spaces for valid Peer IDs
      const safeNick = nickname.replace(/\s+/g, '_');
      const peerId = `pg-user-${safeNick}-${randCode}`;

      this.peer = new Peer(peerId);

      this.peer.on("open", (id) => {
        console.log(`Lobby active. Peer handle: ${this.myHandle} (ID: ${id})`);
        resolve(this.myHandle);
      });

      this.peer.on("connection", (connection) => {
        this.handleIncomingConnection(connection);
      });

      this.peer.on("error", (err) => {
        console.error("PeerJS error:", err);
        reject(err);
      });
    });
  }

  // Perform background pings to check if friends are online
  pingFriends(onUpdate) {
    if (!this.peer || this.peer.destroyed) return;

    this.friends.forEach((friendHandle) => {
      const parts = friendHandle.split("#");
      const name = parts[0].replace(/\s+/g, '_');
      const code = parts[1];
      const friendPeerId = `pg-user-${name}-${code}`;

      // Skip pinging ourselves
      if (friendHandle === this.myHandle) {
        onUpdate(friendHandle, false);
        return;
      }

      // Try brief connection handshake to check state
      const conn = this.peer.connect(friendPeerId, {
        metadata: { isPing: true, senderHandle: this.myHandle }
      });

      let responseTimeout = setTimeout(() => {
        conn.close();
        onUpdate(friendHandle, false);
      }, 2500);

      conn.on("open", () => {
        clearTimeout(responseTimeout);
        onUpdate(friendHandle, true);
        conn.close(); // close ping immediately
      });

      conn.on("error", () => {
        clearTimeout(responseTimeout);
        onUpdate(friendHandle, false);
      });
    });
  }

  startSinglePlayer() {
    this.isSinglePlayer = true;
    this.connections.clear();
    this.lobbyOverlay.classList.remove("active");
    this.lobbyManager.classList.remove("active");
    
    document.getElementById("game-hud").classList.remove("hidden");
    this.peerStatusLight.className = "indicator yellow";
    this.lblConnectionStatus.textContent = "Offline Sandbox";
    this.cryptoAesKey.textContent = "Offline Mode";
    
    this.appendSystemMessage("⚡ Started Offline Sandbox. Customize your look in the Wardrobe and build courses!");
  }

  async startHostingLobby(playerLimit, isPrivate) {
    this.isHost = true;
    this.isSinglePlayer = false;
    this.lobbyPeers = [this.peer.id];
    
    const localPubB64 = await this.generateEcdhKeys();
    
    // Choose Lobby ID
    let roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    if (!isPrivate) {
      // Public lobbies share a matching tag prefix
      roomCode = `pub-${roomCode}`;
    }
    const lobbyId = `pg-room-${roomCode}`;
    this.roomId = roomCode;

    // Create background coordinator node
    const coordPeer = new Peer(lobbyId);

    coordPeer.on("open", () => {
      console.log(`Lobby host coordinator open: ${lobbyId}`);
      if (isPrivate) {
        document.getElementById("lbl-room-code").textContent = roomCode;
        document.getElementById("host-code-box").classList.remove("hidden");
      }
      this.lobbyStatus.textContent = isPrivate ? "Lobby created. Share code to start!" : "Searching for public players...";
    });

    coordPeer.on("connection", (connection) => {
      // Hand off connection details to our user node
      connection.on("open", () => {
        if (this.connections.size >= playerLimit - 1) {
          connection.send({ type: "lobby-full" });
          setTimeout(() => connection.close(), 500);
          return;
        }

        // Direct connect client to our main Peer node
        connection.send({
          type: "coord-handshake",
          hostPeerId: this.peer.id,
          lobbyPeers: this.lobbyPeers
        });
        
        setTimeout(() => connection.close(), 1000);
      });
    });

    coordPeer.on("error", (err) => {
      console.warn("Coordinator collision or error. Re-hosting...", err);
      coordPeer.destroy();
      this.startHostingLobby(playerLimit, isPrivate); // retry
    });
  }

  async joinPrivateLobby(roomCode) {
    this.isHost = false;
    this.isSinglePlayer = false;
    this.roomId = roomCode;
    this.lobbyStatus.textContent = "Connecting to room coordinator...";

    const localPubB64 = await this.generateEcdhKeys();
    const lobbyId = `pg-room-${roomCode}`;

    // Temporarily connect to lobby coordinator to receive host details
    const conn = this.peer.connect(lobbyId);

    conn.on("open", () => {
      console.log("Connected to coordinator. Awaiting handoff...");
    });

    conn.on("data", (data) => {
      if (data.type === "coord-handshake") {
        console.log("Handoff received from coordinator. Connecting to host:", data.hostPeerId);
        
        // Connect to host directly
        this.connectToPeer(data.hostPeerId, localPubB64);
        
        // Connect directly to all other peers already in the lobby
        data.lobbyPeers.forEach((peerId) => {
          if (peerId !== this.peer.id) {
            this.connectToPeer(peerId, localPubB64);
          }
        });

        conn.close();
      } else if (data.type === "lobby-full") {
        this.lobbyStatus.textContent = "Lobby is full! Connection rejected.";
        conn.close();
      }
    });

    conn.on("error", (err) => {
      console.error("Join coordinator error:", err);
      this.lobbyStatus.textContent = "Lobby not found. Verify Room Code.";
    });
  }

  async connectToPeer(targetPeerId, localPubB64) {
    if (this.connections.has(targetPeerId)) return;

    if (!localPubB64) {
      localPubB64 = await this.generateEcdhKeys();
    }

    const connection = this.peer.connect(targetPeerId, {
      metadata: {
        pubKey: localPubB64,
        handle: this.myHandle,
        model: this.game.localMannequinType,
        wardrobe: this.game.localWardrobeOutfit
      }
    });

    this.handleIncomingConnection(connection);
  }

  async handleIncomingConnection(connection) {
    // Check if connection is a lobby ping
    if (connection.metadata && connection.metadata.isPing) {
      connection.on("open", () => {
        connection.send({ type: "ping-ack" });
        setTimeout(() => connection.close(), 100);
      });
      return;
    }

    this.connections.set(connection.peer, connection);

    connection.on("open", () => {
      console.log(`Connected to peer: ${connection.peer}`);
      
      // Perform E2EE handshake
      this.initiateHandshakeWith(connection);
    });

    connection.on("data", (data) => {
      this.handleReceivedPacket(connection.peer, data);
    });

    connection.on("close", () => {
      this.onPeerDisconnected(connection.peer);
    });

    connection.on("error", (err) => {
      console.error(`Connection error with ${connection.peer}:`, err);
      this.onPeerDisconnected(connection.peer);
    });
  }

  async initiateHandshakeWith(connection) {
    try {
      const myPubB64 = await this.generateEcdhKeys();
      
      // Send handshake info
      connection.send({
        type: "handshake",
        pubKey: myPubB64,
        handle: this.myHandle,
        model: this.game.localMannequinType,
        wardrobe: this.game.localWardrobeOutfit
      });
    } catch (e) {
      console.error("Handshake initialization failed:", e);
    }
  }

  async handleReceivedPacket(peerId, data) {
    if (data.type === "handshake") {
      try {
        console.log(`E2EE handshake packet from ${data.handle}. Deriving keys...`);
        const peerPubRaw = base64ToArrayBuffer(data.pubKey);

        const remotePubKey = await window.crypto.subtle.importKey(
          "spki",
          peerPubRaw,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          []
        );

        const sharedAesKey = await window.crypto.subtle.deriveKey(
          { name: "ECDH", public: remotePubKey },
          this.localKeyPair.privateKey,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );

        const rawKey = await window.crypto.subtle.exportKey("raw", sharedAesKey);
        const hexKey = arrayBufferToHex(rawKey);

        this.sharedKeys.set(peerId, sharedAesKey);
        this.sharedKeysHex.set(peerId, hexKey);

        console.log(`Derived AES key for ${data.handle}: ${hexKey}`);

        // Track in Host lobby lists
        if (this.isHost && !this.lobbyPeers.includes(peerId)) {
          this.lobbyPeers.push(peerId);
        }

        // Add visual peer avatar to lobby preview list
        this.game.addLobbyPeer(peerId, data.handle, data.model, data.wardrobe);

        // Update crypto indicator
        this.updateCryptoUI();

        // Update matchmaking visual lights
        this.peerStatusLight.className = "indicator green";
        this.lblConnectionStatus.textContent = `Connected (Lobby: ${this.roomId || "P2P"})`;

        this.appendSystemMessage(`🔒 Encrypted connection established with ${data.handle}.`);

      } catch (err) {
        console.error("Mesh handshake key derivation failed:", err);
      }
    } else if (data.type === "lobby-wardrobe-sync") {
      // Sync client custom clothing inside Lobby preview (Screen 2 & 3)
      this.game.updateLobbyPeerOutfit(peerId, data.model, data.wardrobe);
    } else if (data.type === "start-game-trigger") {
      // Host triggers transition to Screen 3 & 4
      this.game.transitionToGameScreen(data.mapTheme);
    } else if (data.type === "sync") {
      // Direct coordinate position interpolation in 3D world (Screen 4)
      this.game.syncPeerPosition(peerId, data);
    } else if (data.type === "block-place") {
      this.game.world.placeBlockSync(data.pos, data.blockType, data.blockId);
    } else if (data.type === "block-delete") {
      this.game.world.deleteBlockSync(data.blockId);
    } else if (data.type === "wardrobe-change") {
      // Sync mid-game dressing transitions
      this.game.syncPeerOutfit(peerId, data.model, data.wardrobe);
    } else if (data.type === "chat-e2ee") {
      // Decrypt message
      this.decryptAndAppendChat(peerId, data.senderHandle, data.ciphertext, data.iv);
    }
  }

  updateCryptoUI() {
    if (this.sharedKeysHex.size === 0) {
      this.cryptoAesKey.textContent = "Offline Mode";
      this.cryptoAesKey.style.color = "var(--text-muted)";
      return;
    }

    // List active derived hex keys in debug display
    let text = "";
    this.sharedKeysHex.forEach((hex, id) => {
      const truncated = hex.substring(0, 10) + "...";
      text += `Peer: ${truncated}\n`;
    });
    this.cryptoAesKey.textContent = text.trim();
    this.cryptoAesKey.style.color = "var(--green)";
  }

  async sendChatMessage() {
    const text = this.txtChatMessage.value.trim();
    if (!text) return;

    this.txtChatMessage.value = "";

    if (this.isSinglePlayer) {
      this.appendChatMessage("You", text, true);
      this.appendSystemMessage("💬 Note: You are offline. Messages will not be broadcasted.");
      return;
    }

    if (this.connections.size === 0) return;

    // Encrypt and send message to EVERY connected peer using their unique key
    this.connections.forEach(async (conn, peerId) => {
      const key = this.sharedKeys.get(peerId);
      if (!key) return;

      try {
        const encoder = new TextEncoder();
        const encodedText = encoder.encode(text);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));

        const ciphertextBuffer = await window.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv },
          key,
          encodedText
        );

        const ciphertextBase64 = arrayBufferToBase64(ciphertextBuffer);
        const ivBase64 = arrayBufferToBase64(iv);

        conn.send({
          type: "chat-e2ee",
          senderHandle: this.myHandle,
          ciphertext: ciphertextBase64,
          iv: ivBase64
        });
      } catch (err) {
        console.error(`Encryption error for peer ${peerId}:`, err);
      }
    });

    this.appendChatMessage("You", text, true);
  }

  async decryptAndAppendChat(peerId, senderHandle, ciphertextB64, ivB64) {
    const key = this.sharedKeys.get(peerId);
    if (!key) return;

    try {
      const ciphertext = base64ToArrayBuffer(ciphertextB64);
      const iv = base64ToArrayBuffer(ivB64);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        key,
        ciphertext
      );

      const decoder = new TextDecoder();
      const plainText = decoder.decode(decryptedBuffer);

      this.appendChatMessage(senderHandle, plainText, false);
      
      console.log(`[E2EE CHAT PACKET FROM ${senderHandle}]
Ciphertext: ${ciphertextB64}
IV: ${ivB64}
Plaintext: "${plainText}"`);

    } catch (err) {
      console.error("Decryption error:", err);
    }
  }

  // Lobby Outfit updates broadcasting
  broadcastLobbyOutfit(model, wardrobe) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      conn.send({
        type: "lobby-wardrobe-sync",
        model,
        wardrobe
      });
    });
  }

  // Mid-game Dress updates broadcasting
  broadcastInGameOutfit(model, wardrobe) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      conn.send({
        type: "wardrobe-change",
        model,
        wardrobe
      });
    });
  }

  // Match launching
  broadcastStartGame(mapTheme) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      conn.send({
        type: "start-game-trigger",
        mapTheme
      });
    });
  }

  // Core movement coordinates synchronization
  broadcastSync(packet) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send({
          type: "sync",
          ...packet
        });
      }
    });
  }

  // Placed blocks sync
  broadcastBlockPlace(pos, blockType, blockId) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      conn.send({
        type: "block-place",
        pos,
        blockType,
        blockId
      });
    });
  }

  // Deleted blocks sync
  broadcastBlockDelete(blockId) {
    if (this.isSinglePlayer) return;
    this.connections.forEach((conn) => {
      conn.send({
        type: "block-delete",
        blockId
      });
    });
  }

  appendChatMessage(sender, message, isSelf) {
    const div = document.createElement("div");
    div.className = `chat-msg ${isSelf ? 'self' : 'peer'}`;
    
    const authorSpan = document.createElement("span");
    authorSpan.className = "author";
    authorSpan.textContent = `${sender}: `;

    const textSpan = document.createElement("span");
    textSpan.textContent = message;

    div.appendChild(authorSpan);
    div.appendChild(textSpan);
    
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  appendSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "chat-system";
    div.textContent = text;
    this.chatMessages.appendChild(div);
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  onPeerDisconnected(peerId) {
    console.log(`Peer disconnected: ${peerId}`);
    
    this.connections.delete(peerId);
    this.sharedKeys.delete(peerId);
    this.sharedKeysHex.delete(peerId);
    
    this.lobbyPeers = this.lobbyPeers.filter(id => id !== peerId);
    
    this.updateCryptoUI();
    this.game.removePeer(peerId);

    if (this.connections.size === 0 && !this.isSinglePlayer) {
      this.peerStatusLight.className = "indicator red";
      this.lblConnectionStatus.textContent = "Disconnected (Lobby Empty)";
    }
  }

  disconnect() {
    console.log("Shutting down connection node.");
    
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    this.sharedKeys.clear();
    this.sharedKeysHex.clear();
    this.lobbyPeers = [];
    this.isSinglePlayer = false;

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    // Reset indicator HUD values
    this.peerStatusLight.className = "indicator red";
    this.lblConnectionStatus.textContent = "Disconnected";
    this.cryptoAesKey.textContent = "Offline Mode";
    this.cryptoLocalPub.textContent = "Generating...";

    this.chatMessages.innerHTML = "";
    
    this.lobbyOverlay.classList.add("active");
    this.lobbyManager.classList.add("active");
    document.getElementById("game-hud").classList.add("hidden");
    
    this.game.onPeerReset();
  }
}
