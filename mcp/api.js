let servers = {};
let channels = {};

function showServers() {
  dataBox.innerText = "";
  for (let info of Object.values(servers)) {
    const block = document.createElement("div");
    block.innerText = `${info.from} (${info.fromOrigin})`;
    for (let method of info.result) {
      const button = document.createElement("button");
      button.innerText = method;
      button.addEventListener("click", () => {
        RPC(info.from, method, prompt("Input for " + method)).then((result) => {
          alert(JSON.stringify(result));
        });
      });
      block.appendChild(button);
    }
    dataBox.appendChild(block);
  }
}

function setupDataChannel(clientId, channel) {
  channels[clientId] = new Promise((resolve, reject) => {
    channel.onopen = () => {
      console.log("Channel is open!");
      resolve(channel);
      // channel.send("Hello from Peer!");
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
let senders = {};
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

let peers = {};
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
    // showServers();
    return await requestHandlers.listMethods();
  },
  async markAlive(sender, clientIds) {
    for (let key in servers) {
      if (!clientIds.includes(key) && key !== sender.from) {
        delete servers[key];
      }
    }
    // showServers();
  },
  async onConnect(sender, params) {
    if (sender.from === "") {
      hasBroadcastChannel = params.hasBroadcastChannel;
      // hideAuthorizationFrame();
      // dataBox.innerText = "Listing methods...";

      const allServers = await RPC(
        "*",
        "addServer",
        await requestHandlers.listMethods()
      );
      servers = {};
      for (let info of allServers) {
        servers[info.from] = info;
      }
      await NOTIFY("*", "markAlive", Object.keys(servers));
      // showServers();
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
  // genreally responds whenever first reply recieved, except for where clientId='*'
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
  if (requestHandlers[data.method]) {
    console.log("<--", data.from, data.method, data.params);
    const sender = {
      from: data.from,
      fromOrigin: data.fromOrigin,
    };
    senders[data.from] = sender;
    const forceTunnel = ["connectRTC", "addICE"].includes(data.method);
    requestHandlers[data.method](sender, data.params).then(
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

async function configureFrame() {
  const searchParams = new URLSearchParams(location.search);
  let contractURL = new URL("contract.js", location.href);
  if (searchParams.get("dev")) {
    contractURL.searchParams.set("date", Date.now());
    const hash32 = await getHash32(contractURL);
    hostOrigin = "https://" + hash32 + ".caddr.org";
  } else {
    contractURL = new URL(
      "https://caddr-origin.github.io/examples/mcp/contract.js"
    );
    hostOrigin =
      "https://ncljlls7wijmmgmb77jv75u4vwydwmi6py72att437tkb4ne7flq.caddr.org";
  }

  let url = new URL(hostOrigin);
  url.searchParams.set("src", contractURL);
  if (searchParams.get("useRedirect"))
    url.searchParams.set("useRedirect", "true");
  caddrFrame.setAttribute("src", url);
}

async function registerMCPServer(info) {
  await configureFrame();

  for (let tool of info.tools) {
    requestHandlers[tool.name] = tool.execute;
  }
  const describeServer = () => JSON.parse(JSON.stringify(info));
  Object.assign(requestHandlers, {
    showAuthorizationFrame: info.showAuthorizationFrame,
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
  await configureFrame();

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
    showAuthorizationPrompt() {
      info.showAuthorizationFrame();
    },
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

  // for (let tool of info.tools) {
  //   requestHandlers[tool.name] = tool.execute;
  // }
  // const describeServer = () => JSON.parse(JSON.stringify(info));
  // Object.assign(requestHandlers, {
  //   showAuthorizationFrame: info.showAuthorizationFrame,
  //   async gimmeStuff(sender) {
  //     await NOTIFY(sender.from, "addServer", describeServer());
  //   },
  //   async onConnect(sender, params) {
  //     if (sender.from === "") {
  //       hasBroadcastChannel = params.hasBroadcastChannel;
  //       info.hideAuthorizationFrame();
  //       await NOTIFY("*", "newServerAdded", null);
  //     }
  //   },
  // });

  info.insertFrame(caddrFrame);
}
