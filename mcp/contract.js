const button = document.createElement("button");
const url = new URL(location.href);
const clientId = Math.random().toString(36).substring(2, 15);
let lastValue = "";

function postToParent(value) {
  const ancestor = window.opener || window.parent;
  if (window === ancestor) return;
  ancestor.postMessage({ action: "data", value: value }, "*");
}

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
          // const payload = JSON.parse(data)
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

  postToParent(
    JSON.stringify({
      from: "",
      fromOrigin: "",
      to: clientId,
      method: "onConnect",
      params: { clientId: clientId, hasBroadcastChannel: !!channel },
    })
  );

  // cookies which were there before initialization should be excluded
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
      document.cookie = "test=42;SameSite=None;Path=/;Secure"; // safari has some thing where if there are ever no cookies it stops working so we make this long lived
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

// For Safari, we need to show a popup to get storage access. This
// handles when caddr is loaded from a popup.
// TODO: check that this is not loaded from a frame
if (url.searchParams.get("authPopup") || url.searchParams.get("authRedirect")) {
  button.innerText = "Grant storage access";
  button.style.top = 0;
  button.style.left = 0;
  button.style.position = "absolute";
  button.style.width = "100vw";
  button.style.height = "100vh";
  button.onclick = () => {
    makeStorageRequest(
      () => {
        if (url.searchParams.get("authRedirect")) {
          location.href = url.searchParams.get("authRedirect");
        } else {
          if (window.opener) window.opener.retryMountHandle();
          window.close();
        }
      },
      () => {}
    );
  };
  document.body.appendChild(button);
} else if (document.hasStorageAccess) {
  const launchPopup = () => {
    let popupUrl = new URL(location.href);
    if (url.searchParams.get("useRedirect")) {
      // popupUrl.searchParams.set("authRedirect", "redirect URL");
      window.parent.postMessage(
        { action: "redirect", value: popupUrl.toString() },
        "*"
      );
    } else {
      popupUrl.searchParams.set("authPopup", "true");
      if (
        !window.open(popupUrl, "_blank", "width=300,height=200,top=100,popup")
      ) {
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
        // current stable version of chrome may have storage access but state == prompt, but
        // actually support requests without intervention
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
