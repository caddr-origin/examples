const button = document.createElement("button");
const url = new URL(location.href);
let clientId = Math.random().toString(36).substring(2, 15);
let lastValue = "";

function postToParent(value) {
  if (lastValue !== value) {
    lastValue = value;
    const data = JSON.parse(value);
    if (data.to === "*" || data.to === clientId) {
      (window.opener || window.parent).postMessage(
        { action: "data", value: value },
        "*"
      );
    }
  }
}

function mountHandle(handle) {
  let channel = null;

  const getData = () => {
    if (handle && handle.localStorage) {
      return handle.localStorage.getItem("data");
    } else if (typeof localStorage !== "") {
      return localStorage.getItem("data");
    }
  };

  const setData = (data) => {
    if (handle && handle.localStorage) {
      handle.localStorage.setItem("data", data);
    }
    if (channel) {
      channel.postMessage(data);
    }
    if (localStorage) {
      localStorage.setItem("data", data);
    }
  };

  if (handle && handle.BroadcastChannel) {
    channel = handle.BroadcastChannel("data");
    channel.addEventListener("message", (event) => {
      postToParent(getData());
    });
  } else if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("data");
    channel.addEventListener("message", (event) => {
      postToParent(getData());
    });
  }
  window.addEventListener("storage", (event) => {
    if (event.key === "data") {
      postToParent(event.newValue);
    }
  });

  window.addEventListener(
    "message",
    function (event) {
      const data = event.data;
      if (data) {
        setData(
          JSON.stringify({
            from: clientId,
            fromOrigin: event.origin,
            to: data.to,
            method: data.method,
            params: data.params,
            id: data.id,
            result: data.result,
            error: data.error,
          })
        );
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
      params: [{ clientId: clientId }],
    })
  );

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

// For Safari, we need to show a popup to get storage access. This
// handles when caddr is loaded from a popup.
// TODO: check that this is not loaded from a frame
if (url.searchParams.get("authPopup")) {
  button.innerText = "Grant storage access";
  button.style.top = 0;
  button.style.left = 0;
  button.style.position = "absolute";
  button.style.width = "100vw";
  button.style.height = "100vh";
  button.onclick = () => {
    makeStorageRequest(
      () => {
        window.opener.retryMountHandle();
        window.close();
      },
      () => {}
    );
  };
  document.body.appendChild(button);
} else if (document.hasStorageAccess) {
  const launchPopup = () => {
    let popupUrl = new URL(location.href);
    popupUrl.searchParams.set("authPopup", "true");
    window.open(popupUrl, "_blank", "width=300,height=200,top=100,popup");
  };
  const showRequestButton = () => {
    const button = document.createElement("button");
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
  };
  document.hasStorageAccess().then((hasAccess) => {
    if (!hasAccess) {
      showRequestButton();
    } else {
      makeStorageRequest(mountHandle, showRequestButton);
    }
  });
} else {
  mountHandle(null);
}
