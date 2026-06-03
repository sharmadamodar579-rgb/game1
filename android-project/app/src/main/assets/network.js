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
    this.conn = null;
    this.isHost = false;
    this.roomId = null;
    
    // Cryptography state
    this.localKeyPair = null;
    this.remotePublicKey = null;
    this.sharedAesKey = null;
    this.sharedAesKeyHex = null;
    this.isSinglePlayer = false;
    
    this.initUI();
  }

  initUI() {
    this.btnHost = document.getElementById("btn-host");
    this.btnJoin = document.getElementById("btn-join");
    this.btnSingle = document.getElementById("btn-singleplayer");
    this.txtJoinId = document.getElementById("txt-join-id");
    this.lobbyOverlay = document.getElementById("lobby-overlay");
    this.lobbyStatus = document.getElementById("lobby-status");
    this.hostCodeDisplay = document.getElementById("host-code-display");
    this.lblRoomId = document.getElementById("lbl-room-id");
    this.btnExit = document.getElementById("btn-exit");

    this.peerStatusLight = document.getElementById("peer-status-light");
    this.lblConnectionStatus = document.getElementById("lbl-connection-status");
    
    // Crypto UI
    this.cryptoAesKey = document.getElementById("crypto-aes-key");
    this.cryptoLocalPub = document.getElementById("crypto-local-pub");
    this.cryptoRemotePub = document.getElementById("crypto-remote-pub");

    // Chat UI
    this.chatForm = document.getElementById("chat-form");
    this.txtChatMessage = document.getElementById("txt-chat-message");
    this.chatMessages = document.getElementById("chat-messages");
    this.btnToggleChat = document.getElementById("btn-toggle-chat-size");
    this.chatPanel = document.getElementById("chat-panel");

    // Connect event listeners
    this.btnHost.addEventListener("click", () => this.startHosting());
    this.btnJoin.addEventListener("click", () => this.joinRoom());
    this.btnSingle.addEventListener("click", () => this.startSinglePlayer());
    this.btnExit.addEventListener("click", () => this.disconnect());

    // Minimize chat toggle
    this.btnToggleChat.addEventListener("click", () => {
      this.chatPanel.classList.toggle("minimized");
      this.btnToggleChat.textContent = this.chatPanel.classList.contains("minimized") ? "[+]" : "[-]";
    });

    this.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.sendChatMessage();
    });
  }

  async generateEcdhKeys() {
    try {
      this.localKeyPair = await window.crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveKey"]
      );

      const localSpki = await window.crypto.subtle.exportKey("spki", this.localKeyPair.publicKey);
      const b64Key = arrayBufferToBase64(localSpki);
      this.cryptoLocalPub.textContent = b64Key.substring(0, 16) + "...";
      this.cryptoLocalPub.title = b64Key;
      console.log("ECDH key pair generated successfully.");
      return b64Key;
    } catch (err) {
      console.error("Error generating keys:", err);
      this.lobbyStatus.textContent = "Crypto error generating keys.";
    }
  }

  startSinglePlayer() {
    this.isSinglePlayer = true;
    this.conn = null;
    this.peer = null;
    this.lobbyOverlay.classList.remove("active");
    document.getElementById("game-hud").classList.remove("hidden");
    
    this.peerStatusLight.className = "indicator yellow";
    this.lblConnectionStatus.textContent = "Offline Sandbox (Single Player)";
    
    this.cryptoAesKey.textContent = "Offline Mode - No E2EE negotiated";
    this.cryptoAesKey.style.color = "var(--yellow)";
    this.cryptoLocalPub.textContent = "Offline";
    this.cryptoRemotePub.textContent = "-";
    
    this.appendSystemMessage("⚡ Started Offline Single Player Sandbox. Build and explore at your own pace!");
  }

  async startHosting() {
    this.btnHost.disabled = true;
    this.lobbyStatus.textContent = "Generating room credentials...";
    this.isHost = true;

    const localPubB64 = await this.generateEcdhKeys();
    
    // Room ID is a random 4 digit hex code to make sharing easy
    const randCode = Math.floor(1000 + Math.random() * 9000).toString();
    const peerId = `ccraft-${randCode}`;

    this.peer = new Peer(peerId);

    this.peer.on("open", (id) => {
      const roomCode = id.replace("ccraft-", "");
      this.roomId = roomCode;
      this.lblRoomId.textContent = roomCode;
      this.hostCodeDisplay.classList.remove("hidden");
      this.lobbyStatus.textContent = "Waiting for player 2 to connect...";
      console.log(`Lobby active. Peer ID: ${id}`);
    });

    this.peer.on("connection", (connection) => {
      if (this.conn) {
        // Only allow one connected client
        connection.on("open", () => {
          connection.send({ type: "lobby-full" });
          setTimeout(() => connection.close(), 500);
        });
        return;
      }
      this.handleIncomingConnection(connection, localPubB64);
    });

    this.peer.on("error", (err) => {
      console.error("Peer error:", err);
      this.lobbyStatus.textContent = `Hosting error: ${err.type === "unavailable-id" ? "Room code taken. Try again." : err.message}`;
      this.btnHost.disabled = false;
    });
  }

  async joinRoom() {
    const code = this.txtJoinId.value.trim();
    if (!code || code.length < 4) {
      this.lobbyStatus.textContent = "Please enter a valid 4-digit Room ID.";
      return;
    }

    this.btnJoin.disabled = true;
    this.lobbyStatus.textContent = "Connecting to host...";
    this.isHost = false;

    const localPubB64 = await this.generateEcdhKeys();
    const targetPeerId = `ccraft-${code}`;

    this.peer = new Peer();

    this.peer.on("open", () => {
      const connection = this.peer.connect(targetPeerId);
      this.handleIncomingConnection(connection, localPubB64);
    });

    this.peer.on("error", (err) => {
      console.error("Peer connection error:", err);
      this.lobbyStatus.textContent = "Failed to connect to host. Check Room ID.";
      this.btnJoin.disabled = false;
    });
  }

  handleIncomingConnection(connection, localPubB64) {
    this.conn = connection;

    this.conn.on("open", () => {
      console.log("WebRTC channel open. Exchanging public keys...");
      this.lobbyStatus.textContent = "Connection established! Sharing security tokens...";

      // Step 1: Send our ECDH public key to the peer
      this.conn.send({
        type: "handshake",
        pubKey: localPubB64
      });
    });

    this.conn.on("data", (data) => {
      this.handleReceivedPacket(data);
    });

    this.conn.on("close", () => {
      this.disconnect();
    });

    this.conn.on("error", (err) => {
      console.error("Connection stream error:", err);
      this.disconnect();
    });
  }

  async handleReceivedPacket(data) {
    if (data.type === "handshake") {
      try {
        console.log("Received peer's public key. Deriving AES key...");
        const peerPubRaw = base64ToArrayBuffer(data.pubKey);

        this.remotePublicKey = await window.crypto.subtle.importKey(
          "spki",
          peerPubRaw,
          { name: "ECDH", namedCurve: "P-256" },
          true,
          []
        );

        this.sharedAesKey = await window.crypto.subtle.deriveKey(
          { name: "ECDH", public: this.remotePublicKey },
          this.localKeyPair.privateKey,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );

        // Export derived key to HEX for verification
        const rawKey = await window.crypto.subtle.exportKey("raw", this.sharedAesKey);
        this.sharedAesKeyHex = arrayBufferToHex(rawKey);

        this.cryptoRemotePub.textContent = data.pubKey.substring(0, 16) + "...";
        this.cryptoRemotePub.title = data.pubKey;
        this.cryptoAesKey.textContent = this.sharedAesKeyHex;
        this.cryptoAesKey.style.color = "var(--green)";

        console.log("Derived shared AES key:", this.sharedAesKeyHex);

        this.onRoomReady();
      } catch (err) {
        console.error("Key derivation error:", err);
        this.disconnect();
      }
    } else if (data.type === "lobby-full") {
      this.lobbyStatus.textContent = "Room is full. Connection rejected.";
      this.disconnect();
    } else if (data.type === "sync") {
      // Synchronize positions/rotations
      this.game.syncPeerPlayer(data);
    } else if (data.type === "block-place") {
      // Dynamic world building event sync
      this.game.world.placeBlockSync(data.pos, data.blockType, data.blockId);
    } else if (data.type === "block-delete") {
      this.game.world.deleteBlockSync(data.blockId);
    } else if (data.type === "chat-e2ee") {
      // Decode secure chat
      this.decryptAndAppendChat(data.ciphertext, data.iv);
    }
  }

  onRoomReady() {
    this.lobbyOverlay.classList.remove("active");
    document.getElementById("game-hud").classList.remove("hidden");
    
    this.peerStatusLight.classList.remove("red");
    this.peerStatusLight.classList.add("green");
    this.lblConnectionStatus.textContent = `Connected (Room: ${this.roomId || "Peer"})`;

    // Start sync ticking
    this.game.startMultiplayerSync();
    this.appendSystemMessage("🔒 Security Agreement Activated. Direct connection encrypted via AES-256-GCM.");
  }

  async sendChatMessage() {
    const text = this.txtChatMessage.value.trim();
    if (!text) return;

    if (this.isSinglePlayer) {
      this.txtChatMessage.value = "";
      this.appendChatMessage("You", text, true);
      this.appendSystemMessage("💬 Note: You are offline. Messages will not be broadcasted.");
      return;
    }

    if (!this.sharedAesKey) return;

    this.txtChatMessage.value = "";

    try {
      const encoder = new TextEncoder();
      const encodedText = encoder.encode(text);
      
      // AES-GCM IV must be 12 random bytes
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        this.sharedAesKey,
        encodedText
      );

      const ciphertextBase64 = arrayBufferToBase64(ciphertextBuffer);
      const ivBase64 = arrayBufferToBase64(iv);

      // Send base64 encrypted payload
      this.conn.send({
        type: "chat-e2ee",
        ciphertext: ciphertextBase64,
        iv: ivBase64
      });

      this.appendChatMessage("You", text, true);
    } catch (err) {
      console.error("Encryption error:", err);
      this.appendSystemMessage("❌ Encryption failed. Message could not be sent.");
    }
  }

  async decryptAndAppendChat(ciphertextB64, ivB64) {
    if (!this.sharedAesKey) return;

    try {
      const ciphertext = base64ToArrayBuffer(ciphertextB64);
      const iv = base64ToArrayBuffer(ivB64);

      const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        this.sharedAesKey,
        ciphertext
      );

      const decoder = new TextDecoder();
      const plainText = decoder.decode(decryptedBuffer);

      this.appendChatMessage("Peer", plainText, false);
      
      // Console logging to show the user how packets look over the network
      console.log(`[E2EE PACKET RECEIVED] 
Ciphertext: ${ciphertextB64}
IV: ${ivB64}
Decrypted Plaintext: "${plainText}"`);
    } catch (err) {
      console.error("Decryption error:", err);
      this.appendSystemMessage("⚠️ Received message failed authentication/decryption check.");
    }
  }

  sendSyncPacket(packet) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: "sync",
        ...packet
      });
    }
  }

  sendBlockPlace(pos, blockType, blockId) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: "block-place",
        pos,
        blockType,
        blockId
      });
    }
  }

  sendBlockDelete(blockId) {
    if (this.conn && this.conn.open) {
      this.conn.send({
        type: "block-delete",
        blockId
      });
    }
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

  disconnect() {
    console.log("Disconnecting from room.");
    
    this.isSinglePlayer = false;
    
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }

    this.sharedAesKey = null;
    this.sharedAesKeyHex = null;

    // Reset UI
    this.btnHost.disabled = false;
    this.btnJoin.disabled = false;
    this.hostCodeDisplay.classList.add("hidden");
    this.lobbyStatus.textContent = "Disconnected.";
    this.lobbyOverlay.classList.add("active");
    document.getElementById("game-hud").classList.add("hidden");

    this.peerStatusLight.className = "indicator red";
    this.lblConnectionStatus.textContent = "Disconnected";

    this.cryptoAesKey.textContent = "Awaiting connection...";
    this.cryptoAesKey.style.color = "var(--text-muted)";
    this.cryptoLocalPub.textContent = "Generating keys...";
    this.cryptoRemotePub.textContent = "-";

    this.chatMessages.innerHTML = `<div class="chat-system">Session ended. Enter code to reconnect.</div>`;

    this.game.onPeerDisconnected();
  }
}
