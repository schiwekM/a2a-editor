import { useState, useCallback, useEffect } from "react";
import { useConnectionStore } from "@lib/stores/connectionStore";
import { useAgentCardStore } from "@lib/stores/agentCardStore";
import { usePredefinedAgentsStore } from "@lib/stores/predefinedAgentsStore";
import { Card, CardContent, CardHeader, CardTitle } from "@lib/components/ui/card";
import { Input } from "@lib/components/ui/input";
import { PasswordInput } from "@lib/components/ui/PasswordInput";
import { Button } from "@lib/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@lib/components/ui/select";
import { Loader2, Plug, Unplug } from "lucide-react";
import { type ConnAuthType, mapStoreAuthType, buildConnHeaders } from "@lib/utils/connection-auth";

export function ConnectionSection() {
  const {
    url,
    setUrl,
    connectionStatus,
    errorMessage,
    connect,
    disconnect,
    autoConfigureAuth,
    connectionAuthType: storeConnAuthType,
    basicCredentials: storeBasicCreds,
    oauth2Credentials: storeOAuth2Creds,
    apiKeyCredentials: storeApiKeyCreds,
  } = useConnectionStore();
  const { setRawJson } = useAgentCardStore();

  // Track whether the user has manually overridden the auth type
  const [manualAuthType, setManualAuthType] = useState<ConnAuthType | null>(null);

  // Derive connAuthType: manual override takes precedence, otherwise computed from store
  const connAuthType = manualAuthType ?? mapStoreAuthType(storeConnAuthType, !!storeOAuth2Creds.accessToken);

  // Credential fields: read from store only for initialization (see useEffect below)

  // Local credential state — fully independent from store after initialization
  const [localUsername, setLocalUsername] = useState("");
  const [localPassword, setLocalPassword] = useState("");
  const [localToken, setLocalToken] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");

  // Reset and re-initialize from store when connection auth changes (agent switch)
  // Intentionally only depends on storeConnAuthType — not credential values — to avoid
  // re-syncing when SecuritySection writes to the same store credentials.
  useEffect(() => {
    setManualAuthType(null);
    setLocalUsername(storeBasicCreds.username);
    setLocalPassword(storeBasicCreds.password);
    setLocalToken(storeOAuth2Creds.accessToken ?? "");
    setLocalApiKey(storeApiKeyCreds.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeConnAuthType]);

  const handleConnect = useCallback(async () => {
    const headers = buildConnHeaders(connAuthType, localUsername, localPassword, localToken, localApiKey, storeApiKeyCreds.headerName);
    const result = await connect(Object.keys(headers).length > 0 ? headers : undefined);
    if (result) {
      // Persist connection auth credentials to the connection store BEFORE
      // autoConfigureAuth so that when it recomputes authHeaders, it uses
      // the user-entered credentials (e.g. basic auth for A2A messages).
      const connStore = useConnectionStore.getState();
      if (connAuthType !== "none") {
        const storeAuthType = (connAuthType === "bearer" ? "oauth2" : connAuthType) as "basic" | "oauth2" | "apiKey";
        // Set both connectionAuthType and authType so credentials are used for
        // card fetching AND A2A messages (autoConfigureAuth may override authType
        // if the card declares a different security scheme).
        useConnectionStore.setState({ connectionAuthType: storeAuthType });
        connStore.setAuthType(storeAuthType);
      }
      switch (connAuthType) {
        case "basic":
          connStore.setBasicCredentials({ username: localUsername, password: localPassword });
          break;
        case "bearer":
          connStore.setOAuth2Credentials({ accessToken: localToken });
          break;
        case "apiKey":
          connStore.setApiKeyCredentials({ key: localApiKey });
          break;
      }

      setRawJson(result.rawJson);
      autoConfigureAuth(result.card);

      // Persist modified URL and auth back to selected predefined agent
      const { selectedId, updateAgent } = usePredefinedAgentsStore.getState();
      if (selectedId) {
        const currentUrl = useConnectionStore.getState().url;
        const updatedConnStore = useConnectionStore.getState();
        const updates: Record<string, unknown> = {
          url: currentUrl,
          authType: updatedConnStore.authType,
          authConfig: buildStoredAuthConfig(updatedConnStore.authType, updatedConnStore.basicCredentials, updatedConnStore.oauth2Credentials, updatedConnStore.apiKeyCredentials),
        };
        if (connAuthType !== "none") {
          updates.connectionAuthType = connAuthType === "bearer" ? "oauth2" : connAuthType;
          updates.connectionAuthConfig = buildStoredConnAuthConfig(connAuthType, localUsername, localPassword, localToken, localApiKey, storeApiKeyCreds.headerName);
        } else {
          updates.connectionAuthType = undefined;
          updates.connectionAuthConfig = undefined;
        }
        updateAgent(selectedId, updates);
      }
    }
  }, [connAuthType, localUsername, localPassword, localToken, localApiKey, storeApiKeyCreds.headerName, connect, setRawJson, autoConfigureAuth]);

  const statusColor = {
    disconnected: "bg-muted",
    connecting: "bg-warning",
    connected: "bg-success",
    error: "bg-destructive",
  }[connectionStatus];

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Connection</CardTitle>
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColor}`} />
            <span className="text-xs text-muted-foreground capitalize" data-testid="connection-status">
              {connectionStatus}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Agent URL</label>
          <div className="flex gap-2">
          <Input
            placeholder="Agent URL"
            data-testid="connection-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && connectionStatus !== "connecting" && handleConnect()}
            className="h-8 text-sm"
          />
          {connectionStatus === "connected" ? (
            <Button variant="outline" size="sm" onClick={disconnect} className="h-8 shrink-0" data-testid="disconnect-btn">
              <Unplug className="h-4 w-4 mr-1" />
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!url || connectionStatus === "connecting"}
              className="h-8 shrink-0"
              data-testid="connect-btn"
            >
              {connectionStatus === "connecting" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Plug className="h-4 w-4 mr-1" />
              )}
              Connect
            </Button>
          )}
          </div>
        </div>

        {/* Auth for fetching agent card — independent of card's securitySchemes */}
        <form onSubmit={(e) => { e.preventDefault(); handleConnect(); }} className="space-y-2">
          <Select value={connAuthType} onValueChange={(v) => setManualAuthType(v as ConnAuthType)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No Authentication</SelectItem>
              <SelectItem value="basic">Basic Auth</SelectItem>
              <SelectItem value="bearer">Bearer Token</SelectItem>
              <SelectItem value="apiKey">API Key</SelectItem>
            </SelectContent>
          </Select>

          {connAuthType === "basic" && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-muted-foreground">Username</label>
                <Input
                  placeholder="Username"
                  value={localUsername}
                  onChange={(e) => setLocalUsername(e.target.value)}
                  className="h-8 text-sm"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Password</label>
                <PasswordInput
                  placeholder="Password"
                  value={localPassword}
                  onChange={(e) => setLocalPassword(e.target.value)}
                  className="h-8 text-sm"
                  autoComplete="off"
                />
              </div>
            </div>
          )}

          {connAuthType === "bearer" && (
            <div>
              <label className="text-xs text-muted-foreground">Bearer Token</label>
              <PasswordInput
                placeholder="Bearer Token"
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                className="h-8 text-sm"
                autoComplete="off"
              />
            </div>
          )}

          {connAuthType === "apiKey" && (
            <div>
              <label className="text-xs text-muted-foreground">API Key</label>
              <PasswordInput
                placeholder="API Key"
                value={localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                className="h-8 text-sm"
                autoComplete="off"
              />
            </div>
          )}
        </form>

        {errorMessage && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Build auth config object for persisting connection auth (card fetching) to predefined agent. */
function buildStoredConnAuthConfig(
  authType: ConnAuthType,
  username: string,
  password: string,
  token: string,
  apiKey: string,
  headerName: string,
): Record<string, string> | undefined {
  switch (authType) {
    case "basic":
      return { username, password };
    case "bearer":
      return { accessToken: token, clientId: "", clientSecret: "", tokenUrl: "", scopes: "" };
    case "apiKey":
      return { key: apiKey, headerName };
    default:
      return undefined;
  }
}

/** Build auth config object for persisting A2A message auth to predefined agent. */
function buildStoredAuthConfig(
  authType: string,
  basicCredentials: { username: string; password: string },
  oauth2Credentials: { clientId: string; clientSecret: string; tokenUrl: string; scopes: string; accessToken?: string },
  apiKeyCredentials: { key: string; headerName: string },
): Record<string, string> | undefined {
  switch (authType) {
    case "basic":
      return { ...basicCredentials };
    case "oauth2":
      return { ...oauth2Credentials };
    case "apiKey":
      return { ...apiKeyCredentials };
    default:
      return undefined;
  }
}
