const button = document.createElement("button");
const url = new URL(location.href);

// Because on Firefox and Safari we need to fall back
// to cookie storage, and there is a maximum of 4KB
// per domain. Additionally, because of state partitioning
// on Firefox, BroadcastChannel only speeds up the rare situations
// where the top-level origins are the same.

function postToParent(value) {
  (window.opener || window.parent).postMessage(
    { action: "data", value: value },
    "*",
  );
}

function mountHandle(handle) {
  let lastValue = getData();

  const getData = () => {
    if (handle && handle.localStorage) {
      return handle.localStorage.getItem("data");
    } else {
      const values = Object.fromEntries(
        document.cookie
          .split(";")
          .map((k) => k.trim().split("=").map(decodeURIComponent)),
      );
      return values["data"];
    }
  };

  const setData = (data) => {
    lastValue = data;
    if (handle && handle.localStorage) {
      handle.localStorage.setItem("data", data);
    } else {
      document.cookie =
        "data=" + encodeURIComponent(data) + ";SameSite=None;Path=/;Secure";
    }
    bc.postMessage(data);
  };

  const pollingLoop = () => {
    let newData = getData();
    if (newData !== lastValue) {
      lastValue = newData;
      postToParent(newData);
    }
  };

  if (handle && handle.localStorage) {
    window.addEventListener("storage", pollingLoop);
  } else if (window.cookieStore) {
    cookieStore.onchange = pollingLoop;
  } else {
    setInterval(pollingLoop, 250);
  }
  let bc = new BroadcastChannel("caddr");
  bc.onmessage = pollingLoop;

  postToParent(lastValue);

  window.addEventListener(
    "message",
    function (event) {
      const data = event.data;
      if (data && data.action) {
        if (data.action === "save" && data.value !== undefined) {
          setData(data.value);
        } else if (data.action === "load") {
          postToParent(getData());
        }
      }
    },
    false,
  );

  if (button.parentNode) {
    button.remove();
  }
}

function makeStorageRequest(successCallback, errorCallback) {
  document.requestStorageAccess({ all: true }).then((handle) => {
    document.cookie = "test=42;SameSite=None;Path=/;Secure;Max-Age=10";
    if (document.cookie === "") {
      errorCallback("Test cookie not set");
    } else {
      successCallback(handle);
    }
  }, errorCallback);
}

function retryMountHandle() {
  makeStorageRequest(
    (handle) => mountHandle(handle),
    (err) => {
      console.error(err);
    },
  );
}

// For Safari, we need to show a popup to get storage access. This
// handles when caddr is loaded from a popup.
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
      () => {},
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
