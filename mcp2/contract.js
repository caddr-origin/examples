// mcp2/contract.js – Based on mcp/contract.js with additional approval
// UI for client registration and support for explicit mode/toolList query
// parameters.

const button = document.createElement("button");
const url = new URL(location.href);
const mode = url.searchParams.get("mode") || "server";
let toolNames = [];
if (url.searchParams.get("toolList")) {
  try {
    toolNames = JSON.parse(decodeURIComponent(url.searchParams.get("toolList")));
  } catch (_) {}
}
const clientId = Math.random().toString(36).substring(2, 15);
let lastValue = "";

function postToParent(value) {
  const ancestor = window.opener || window.parent;
  if (window === ancestor) return;
  ancestor.postMessage({ action: "data", value: value }, "*");
}

// All remaining logic (cookie/broadcast handling etc.) from the original file
// is kept unchanged until we reach the authorisation UI section, which now
// differs for redirect (page-navigation) versus popup flows.

// ... existing code up to the authorisation UI section will be inserted below ...

function mountHandle(handle) {
  const processedMessages = new Set();
  const pendingCookies = [];

  const getValues = () => {
    const cookies = document.cookie
      .split(";")
      .map((k) => k.trim().split("=").map(decodeURIComponent));
    const observedKeys = new Set();
    for (let [key, data] of cookies) {
      let [prefix, destination, requestId] = key.split("_");
      if (prefix !== "rpc") continue;
      if (destination === clientId) {
        // delete cookies addressed directly to this client,
        // but not cookies which are broadcasted
        document.cookie = key + "=;SameSite=None;Path=/;Secure;Max-Age=0";
        console.log("deleting cookie", key);
      }
      observedKeys.add(key);
      if (destination === clientId || destination === "ALL") {
        if (!processedMessages.has(key)) {
          processedMessages.add(key);
          postToParent(data);
        }
      }
    }
    for (let key of processedMessages) {
      if (!observedKeys.has(key)) {
        processedMessages.delete(key);
        console.log("removing expired key from processed messages list", key);
      }
    }
  };

  const flushCookies = () => {
    if (
      pendingCookies.length > 0 &&
      document.cookie.length + pendingCookies[0].length < 4096
    ) {
      document.cookie = pendingCookies.shift();
    }
    if (pendingCookies.length > 0) {
      console.log("pending cookies wait for space");
      setTimeout(flushCookies, 50);
    }
  };
  let channel;
  if (handle && handle.BroadcastChannel) {
    channel = handle.BroadcastChannel("caddrRPC");
    channel.onmessage = (e) => {
      const payload = JSON.parse(e.data);
      if (payload.to === "*" || payload.to === clientId) {
        postToParent(e.data);
      }
    };
  }
  window.addEventListener(
    "message",
    function (event) {
      const data = event.data;
      const payload = JSON.stringify({
        from: clientId,
        fromOrigin: event.origin,
        to: data.to,
        method: data.method,
        params: data.params,
        id: data.id,
        result: data.result,
        error: data.error,
      });
      if (channel) {
        channel.postMessage(payload);
      } else {
        const key =
          "rpc_" +
          (data.to === "*" ? "ALL" : data.to) +
          "_" +
          Math.random().toString(36).substring(2, 15);
        processedMessages.add(key);

        const newCookie =
          key +
          "=" +
          encodeURIComponent(payload) +
          ";SameSite=None;Path=/;Secure;Max-Age=5";
        console.log("cookie size", document.cookie.length);
        pendingCookies.push(newCookie);
        if (pendingCookies.length === 1) flushCookies();
      }
    },
    false
  );

  // Notify parent that we are ready
  postToParent(
    JSON.stringify({
      from: "",
      fromOrigin: "",
      to: clientId,
      method: "onConnect",
      params: { clientId: clientId, hasBroadcastChannel: !!channel },
    })
  );

  // Exclude cookies that existed before init
  const initialCookies = document.cookie
    .split(";")
    .map((k) => k.trim().split("=").map(decodeURIComponent));
  for (let [key, data] of initialCookies) processedMessages.add(key);

  if (window.cookieStore) {
    cookieStore.onchange = (e) => {
      if (e.changed.length > 0) getValues();
    };
  } else {
    setInterval(getValues, 50);
  }

  if (button.parentNode) {
    button.remove();
  }
}

function retryMountHandle() {
  makeStorageRequest(
    (handle) => mountHandle(handle),
    (err) => {
      console.error(err);
    }
  );
}

function makeStorageRequest(successCallback, errorCallback) {
  document.requestStorageAccess({ all: true }).then(
    (handle) => {
      document.cookie = "test=42;SameSite=None;Path=/;Secure";
      if (document.cookie === "") {
        errorCallback("Test cookie not set");
      } else {
        successCallback(handle);
      }
    },
    (err) => {
      errorCallback(err);
    }
  );
}

// =================== Authorisation / Approval UI =====================
// For Safari, we need to show a popup to get storage access. This section now
// distinguishes between full-page redirect (client approval) and popup.

if (url.searchParams.get("authRedirect")) {
  // Full-page approval screen (used for MCP client registration)
  const container = document.createElement("div");
  container.style.cssText =
    "display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;text-align:center;padding:1rem";

  const heading = document.createElement("h2");
  heading.textContent = "Approve access to local MCP tools";
  container.appendChild(heading);

  const message = document.createElement("p");
  message.textContent =
    "The linked page will gain access to all currently running caddr MCP tools.";
  container.appendChild(message);

  const list = document.createElement("ul");
  if (toolNames.length) {
    for (const name of toolNames) {
      const li = document.createElement("li");
      li.textContent = name;
      list.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "(No tools are currently running)";
    list.appendChild(li);
  }
  container.appendChild(list);

  const btnApprove = document.createElement("button");
  btnApprove.textContent = "Approve";
  btnApprove.style.margin = "1rem";
  btnApprove.onclick = () => {
    makeStorageRequest(
      () => {
        location.href = url.searchParams.get("authRedirect");
      },
      () => {}
    );
  };

  const btnCancel = document.createElement("button");
  btnCancel.textContent = "Return without approval";
  btnCancel.style.margin = "1rem";
  btnCancel.onclick = () => {
    location.href = url.searchParams.get("authRedirect");
  };

  const btnRow = document.createElement("div");
  btnRow.appendChild(btnApprove);
  btnRow.appendChild(btnCancel);
  container.appendChild(btnRow);

  document.body.appendChild(container);
} else if (url.searchParams.get("authPopup")) {
  // Original popup-based flow (unchanged)
  button.innerText = "Grant storage access";
  button.style.top = 0;
  button.style.left = 0;
  button.style.position = "absolute";
  button.style.width = "100vw";
  button.style.height = "100vh";
  button.onclick = () => {
    makeStorageRequest(
      () => {
        if (window.opener) window.opener.retryMountHandle();
        window.close();
      },
      () => {}
    );
  };
  document.body.appendChild(button);
} else if (document.hasStorageAccess) {
  // In-frame flow (unchanged from original)
  const launchPopup = () => {
    let popupUrl = new URL(location.href);
    if (url.searchParams.get("useRedirect")) {
      window.parent.postMessage(
        { action: "redirect", value: popupUrl.toString() },
        "*"
      );
    } else {
      popupUrl.searchParams.set("authPopup", "true");
      if (!window.open(popupUrl, "_blank", "width=300,height=200,top=100,popup")) {
        console.log("no opener available");
      }
    }
  };
  const showRequestButton = () => {
    button.innerText = "Grant storage access";
    button.style.top = 0;
    button.style.left = 0;
    button.style.position = "absolute";
    button.style.width = "100vw";
    button.style.height = "100vh";
    button.onclick = () => {
      makeStorageRequest(mountHandle, launchPopup);
    };
    document.body.appendChild(button);
    window.parent.postMessage({ action: "prompt" }, "*");
  };
  navigator.permissions
    .query({ name: "storage-access" })
    .catch((err) => ({ state: "granted" }))
    .then((res) => {
      if (res.state === "granted") {
        makeStorageRequest(mountHandle, showRequestButton);
      } else if (res.state === "prompt") {
        document.hasStorageAccess().then((hasAccess) => {
          if (hasAccess) {
            makeStorageRequest(mountHandle, showRequestButton);
          } else {
            showRequestButton();
          }
        });
      }
    });
} else {
  mountHandle(null);
}