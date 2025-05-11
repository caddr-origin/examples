// document.open()
// document.write('Hello Content-Addressed World!')
// document.close()

const createPasskeyButton = document.createElement("button");
createPasskeyButton.textContent = "Create Passkey";
document.body.appendChild(createPasskeyButton);

createPasskeyButton.addEventListener("click", async () => {
  try {
    const createOptions = {
      challenge: new Uint8Array(16),
      rp: {
        name: "webauthn.example",
      },
      user: {
        id: new Uint8Array(16),
        name: "user@example.com",
        displayName: "User",
      },
      pubKeyCredParams: [
        {
          type: "public-key",
          alg: -7, // ECDSA w/ SHA-256
        },
      ],
      timeout: 60000,
      attestation: "none",
    };

    const credential = await navigator.credentials.create({
      publicKey: createOptions,
    });

    console.log(credential);
    const response = credential.response;
    console.log(response);
    const clientExtensionsResults = credential.getClientExtensionResults();

    console.log(clientExtensionsResults);

    createdCredential = credential;

    alert("Passkey created!");
  } catch (err) {
    alert("Error: " + err);
  }
});

const signWithPasskeyButton = document.createElement("button");
signWithPasskeyButton.textContent = "Sign with Passkey";
document.body.appendChild(signWithPasskeyButton);

signWithPasskeyButton.addEventListener("click", async () => {
  const credential = await navigator.credentials.get({
    publicKey: {
      // Challenge from your server (must be a random buffer, converted to ArrayBuffer)
      challenge: new Uint8Array([
        /* random bytes from server */
      ]).buffer,

      // Optional: Limit which credentials can be used by specifying their IDs
      allowCredentials: [
        // You can include previously registered credential IDs
        // { type: "public-key", id: credentialIdFromServer }
      ],

      // Timeout in milliseconds
      timeout: 60000,
    },
  });

  console.log(credential);
});
