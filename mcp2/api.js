// mcp2/api.js – Enhanced version of MCP API with explicit mode handling in
// the query-string, redirect-based client approval UI and stricter call rules.
// This file is based on mcp/api.js (original 2024-06-30) with minimal
// modifications clearly marked by comments that start with "MOD:".

/* ********************************************************************** */
/*                       SHARED STATE & HELPERS                           */
/* ********************************************************************** */

let channels = {};
let peers = {};
let senders = {};
let servers = {};

// MOD: Track the current operating mode so we can enforce client restrictions.
let currentMode = null; // "client" | "server" | null
// MOD: Methods always allowed to be invoked on a client from a remote server.
const INTERNAL_METHODS = new Set([
  "addServer",
  "gimmeStuff",
  "newServerAdded",
  "onConnect",
  "connectRTC",
  "addICE",
  "listMethods",
  "echo",
  "setBackgroundColor",
]);

function setupDataChannel(clientId, channel) {
  channels[clientId] = new Promise((resolve, reject) => {
    channel.onopen = () => {
      console.log("Channel is open!");
      resolve(channel);
    };

    channel.onmessage = (event) => {
      console.log("Message received on:", event.data);
      handleMessage({
        ...JSON.parse(event.data),
        ...senders[clientId],
      });
    };

    channel.onclose = (event) => {
      console.log("channel closed", event);
      delete channels[clientId];
    };
  });
}

async function connectDataChannel(clientId) {
  const peerA = new RTCPeerConnection({
    //   iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  peers[clientId] = peerA;
  const channelA = peerA.createDataChannel("myChannel");
  setupDataChannel(clientId, channelA);
  peerA.onconnectionstatechange = () => {
    console.log(`Peer A connection state: ${peerA.connectionState}`);
  };
  peerA.oniceconnectionstatechange = () => {
    console.log(`Peer A ICE state: ${peerA.iceConnectionState}`);
  };

  let earlyCandidates = [];
  peerA.onicecandidate = (event) => {
    if (event.candidate) {
      earlyCandidates.push(event.candidate.toJSON());
      console.log("CANDIDATE EARLY", event);
    }
  };
  const offer = await peerA.createOffer();
  await peerA.setLocalDescription(offer);
  console.log("got offer", offer);
  const answer = await RPC(clientId, "connectRTC", offer);
  console.log("got answer", answer);
  await peerA.setRemoteDescription(answer);
  for (let candidate of earlyCandidates) {
    NOTIFY(clientId, "addICE", candidate);
  }
  peerA.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("sending ice candidate", event);
      NOTIFY(clientId, "addICE", event.candidate.toJSON());
    }
  };
}

const requestHandlers = {
  showAuthorizationPrompt() {},
  async echo(sender, data) {
    return "Echo: " + data;
  },
  async setBackgroundColor(sender, color) {
    document.body.style.background = color;
  },
  async listMethods() {
    return Object.keys(requestHandlers);
  },
  async connectRTC(sender, offer) {
    console.log("got offer", offer);
    const peerB = new RTCPeerConnection({
      // iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peers[sender.from] = peerB;
    peerB.onconnectionstatechange = () => {
      console.log(`Peer B connection state: ${peerB.connectionState}`);
    };
    peerB.oniceconnectionstatechange = () => {
      console.log(`Peer B ICE state: ${peerB.iceConnectionState}`);
    };
    peerB.onicecandidate = (event) => {
      if (event.candidate) {
        console.log("sending ice candidate", event);
        NOTIFY(sender.from, "addICE", event.candidate.toJSON());
      }
    };
    peerB.ondatachannel = (event) => {
      const channelB = event.channel;
      setupDataChannel(sender.from, channelB);
    };

    await peerB.setRemoteDescription(offer);
    const answer = await peerB.createAnswer();
    await peerB.setLocalDescription(answer);
    console.log("got answer", answer);
    return answer;
  },
  async addICE(sender, candidate) {
    peers[sender.from].addIceCandidate(candidate);
  },
  async addServer(sender, methods) {
    servers[sender.from] = {
      from: sender.from,
      fromOrigin: sender.fromOrigin,
      result: methods,
    };
    return await requestHandlers.listMethods();
  },
  async onConnect(sender, params) {
    if (sender.from === "") {
      hasBroadcastChannel = params.hasBroadcastChannel;
    }
  },
};

async function NOTIFY(clientId, method, params) {
  const forceTunnel = ["connectRTC", "addICE"].includes(method);
  sendRPCMessage(
    {
      to: clientId,
      method: method,
      params: params,
    },
    forceTunnel
  );
}

async function RPC(clientId, method, params) {
  // generally responds whenever first reply received, except for where clientId='*'
  // then we wait until a timeout and return an array with all replies.

  const replyId = replyIdCounter++;
  console.log("-->", clientId, replyId, method, params);
  return new Promise((resolve, reject) => {
    const forceTunnel = ["connectRTC", "addICE"].includes(method);
    sendRPCMessage(
      {
        to: clientId,
        id: replyId,
        method: method,
        params: params,
      },
      forceTunnel
    );
    if (clientId === "*") {
      const replies = {};
      replyCallbacks[replyId] = (reply) => {
        replies[reply.from] = reply;
      };
      setTimeout(() => {
        delete replyCallbacks[replyId];
        resolve(Object.values(replies));
      }, 2000);
    } else {
      replyCallbacks[replyId] = (reply) => {
        delete replyCallbacks[replyId];
        if (reply.error) {
          reject(reply.error);
        } else {
          resolve(reply.result);
        }
      };
    }
  });
}

// send(clientId, method, data)
// how do replies work? we have multiple replies from multiple clients because broadcast is ok i guess.
const replyCallbacks = {};
let replyIdCounter = 1;

function handleMessage(data) {
  // MOD: Block remote server from invoking arbitrary client APIs.
  if (
    currentMode === "client" &&
    data.from !== "" &&
    !INTERNAL_METHODS.has(data.method)
  ) {
    console.warn(
      `Blocked server-initiated call to client API '${data.method}'.`,
      data
    );
    if (data.id) {
      // Tell the caller the action is forbidden.
      sendRPCMessage({
        to: data.from,
        id: data.id,
        error: "Forbidden: server cannot invoke client-side API methods.",
      });
    }
    return;
  }

  if (requestHandlers[data.method]) {
    console.log("<--", data.from, data.method, data.params);
    const sender = {
      from: data.from,
      fromOrigin: data.fromOrigin,
    };
    senders[data.from] = sender;
    const forceTunnel = ["connectRTC", "addICE"].includes(data.method);
    Promise.resolve(requestHandlers[data.method](sender, data.params)).then(
      (result) => {
        if (data.id) {
          sendRPCMessage(
            {
              to: data.from,
              result: result,
              id: data.id,
            },
            forceTunnel
          );
        }
      },
      (error) => {
        console.error(error);
        if (data.id) {
          sendRPCMessage(
            {
              to: data.from,
              error: error,
              id: data.id,
            },
            forceTunnel
          );
        }
      }
    );
  } else if (data.id) {
    console.log("<--", data.from, data);
    if (replyCallbacks[data.id]) {
      replyCallbacks[data.id](data);
    } else {
      console.log("no reply callback for id", data.id, data);
    }
  } else {
    console.log("<--", data);
  }
}

function sendRPCMessage(message, forceTunnel = false) {
  const payload = JSON.stringify(message);
  if (hasBroadcastChannel) forceTunnel = true;
  if (message.to === "*") forceTunnel = true;
  if (channels[message.to] && !forceTunnel) {
    console.log("sending message to channel", message);
    channels[message.to].then((channel) => {
      channel.send(payload);
    });
  } else if (!forceTunnel && payload.length > 1024) {
    console.log("connecting to channel", message);
    connectDataChannel(message.to);
    channels[message.to].then((channel) => {
      channel.send(payload);
    });
  } else {
    console.log("sending message", message);
    caddrFrame.contentWindow.postMessage(message, hostOrigin);
  }
}

window.addEventListener(
  "message",
  function (event) {
    // console.log(event.origin, event.data)
    // Always check the origin for security reasons
    if (event.origin === hostOrigin) {
      if (event.data.action === "redirect") {
        let url = new URL(event.data.value);
        url.searchParams.set("authRedirect", location.href);
        location.href = url;
        return;
      } else if (event.data.action === "data") {
        const data = JSON.parse(event.data.value);
        handleMessage(data);
      } else if (event.data.action === "prompt") {
        // this is where we should show the prompt UI
        requestHandlers.showAuthorizationPrompt();
      }
    }
  },
  false
);

let hostOrigin = "";
let hasBroadcastChannel = false;

async function getHash32(url) {
  let n =
      (new Uint8Array(
        await fetch(url)
          .then((k) => k.arrayBuffer())
          .then((k) => crypto.subtle.digest("SHA-256", k))
      ).reduce((acc, k) => acc * 256n + BigInt(k), 0n) *
        256n ** 3n) /
      32n ** 3n,
    res = "";
  while ((n /= 32n) !== 0n)
    res = "abcdefghijklmnopqrstuvwxyz234567"[Number(n % 32n)] + res;
  return res;
}

let caddrFrame = document.createElement("iframe");
caddrFrame.id = "caddrFrame";
caddrFrame.frameBorder = 0;
caddrFrame.style.width = "100%";
caddrFrame.style.height = "80px";

// MOD: configureFrame now accepts explicit mode info and tool list.
async function configureFrame(
  mode,
  toolNames = [],
  forceRedirect = false /* only used for client mode */
) {
  currentMode = mode;

  const searchParams = new URLSearchParams(location.search);
  let contractURL;
  if (searchParams.get("dev")) {
    // Local copy for dev – refer to mcp2/contract.js
    contractURL = new URL("contract.js", location.href);
    contractURL.searchParams.set("date", Date.now());
    const hash32 = await getHash32(contractURL);
    hostOrigin = "https://" + hash32 + ".caddr.org";
  } else {
    contractURL = new URL(
      "https://caddr-origin.github.io/examples/mcp2/contract.js"
    );
    hostOrigin =
      "https://ncljlls7wijmmgmb77jv75u4vwydwmi6py72att437tkb4ne7flq.caddr.org";
  }

  let url = new URL(hostOrigin);
  url.searchParams.set("src", contractURL);
  url.searchParams.set("mode", mode);

  if (toolNames.length) {
    try {
      url.searchParams.set(
        "toolList",
        encodeURIComponent(JSON.stringify(toolNames))
      );
    } catch (err) {
      console.warn("Unable to encode tool list:", err);
    }
  }

  // For client mode we *mandate* redirect unless explicitly disabled at top-level
  // with ?useRedirect=false – design choice for stricter default.
  if (
    forceRedirect ||
    (mode === "client" && searchParams.get("useRedirect") !== "false")
  ) {
    url.searchParams.set("useRedirect", "true");
  } else if (searchParams.get("useRedirect") !== "false") {
    url.searchParams.set("useRedirect", "true");
  }

  caddrFrame.setAttribute("src", url.toString());
}

async function registerMCPServer(info) {
  await configureFrame("server", []);

  for (let tool of info.tools) {
    requestHandlers[tool.name] = tool.execute;
  }
  const describeServer = () => JSON.parse(JSON.stringify(info));
  Object.assign(requestHandlers, {
    showAuthorizationPrompt: info.showAuthorizationFrame,
    async gimmeStuff(sender) {
      await NOTIFY(sender.from, "addServer", describeServer());
    },
    async onConnect(sender, params) {
      if (sender.from === "") {
        hasBroadcastChannel = params.hasBroadcastChannel;
        info.hideAuthorizationFrame();
        await NOTIFY("*", "newServerAdded", null);
      }
    },
  });

  info.insertFrame(caddrFrame);
}

async function registerMCPClient(info) {
  const toolNames = (info.tools || []).map((t) => t.name);
  await configureFrame("client", toolNames, true /* forceRedirect */);

  let serverState = {};
  Object.assign(requestHandlers, {
    async gimmeStuff(sender) {},
    async addServer(sender, data) {
      console.log("addServer", sender, data);
      serverState[sender.from] = {
        ...data,
        from: sender.from,
        fromOrigin: sender.fromOrigin || "",
      };
      info.updateServerList(serverState);
    },
    async newServerAdded(sender) {
      serverState = {};
      await NOTIFY("*", "gimmeStuff", null);
    },
    showAuthorizationPrompt: info.showAuthorizationFrame,
    async onConnect(sender, params) {
      if (sender.from === "") {
        hasBroadcastChannel = params.hasBroadcastChannel;
        info.hideAuthorizationFrame();

        console.log("sending a notify");
        serverState = {};
        await NOTIFY("*", "gimmeStuff", null);
      }
    },
  });

  info.insertFrame(caddrFrame);
}