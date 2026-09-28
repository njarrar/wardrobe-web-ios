import { useState } from "react";
import { accessToken, isNativeApp, saveConnection, serverUrl } from "./api.js";
import "./outfits.css";

const MESSAGES = {
  setup: "Enter your Wardrobe address (your Cloudflare Worker or your computer) and its access token.",
  token: "This wardrobe is protected. Enter the WARDROBE_TOKEN from its .env file.",
  unreachable: "Could not reach your wardrobe. Check the address, and that the server is running.",
};

export function ConnectScreen({ reason }) {
  const native = isNativeApp();
  const [server, setServer] = useState(serverUrl() || "https://");
  const [token, setToken] = useState(accessToken());

  const submit = (event) => {
    event.preventDefault();
    saveConnection({ server: native ? server : undefined, token });
    window.location.reload();
  };

  return (
    <main className="connect-screen">
      <form className="connect-card" onSubmit={submit}>
        <h1>Wardrobe</h1>
        <p>{MESSAGES[reason] || MESSAGES.setup}</p>
        {native && (
          <label className="field">
            <span>Server address</span>
            <input type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" value={server} onChange={(event) => setServer(event.target.value)} placeholder="https://wardrobe.you.workers.dev" required />
          </label>
        )}
        <label className="field">
          <span>Access token</span>
          <input type="password" autoCapitalize="off" autoCorrect="off" value={token} onChange={(event) => setToken(event.target.value)} required={reason === "token"} />
        </label>
        <button className="primary-button" type="submit">Connect</button>
      </form>
    </main>
  );
}
