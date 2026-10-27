
const API = "http://15.235.181.233:62163";
const $ = id => document.getElementById(id);

let connected = false;
let allBusy = false;
let logsBusy = false;
let lookupBusy = false;
let commandBusy = false;
let allTimer = null;
let logsTimer = null;

function getToken() {
    return $("token").value.trim();
}

function baseURL() {
    return `${API}/${encodeURIComponent(getToken())}`;
}

async function requestJSON(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

function setConnection(isConnected) {
    const el = $("connection");
    el.classList.toggle("connected", isConnected);
    el.lastChild.textContent = isConnected ? " Online" : " Offline";
}

function displayValue(value) {
    return value == null ? "—" : String(value);
}

function reportError(label, error) {
    console.error(`${label}:`, error);
}

async function refreshPlayers() {
    const data = await requestJSON(`${baseURL()}/players`);

    $("online").textContent = displayValue(data.count);
    $("player-count").textContent =
        `${data.count ?? (data.players || []).length} players`;

    const container = $("players");
    container.replaceChildren();

    if (!data.players || data.players.length === 0) {
        const span = document.createElement("span");
        span.className = "muted";
        span.textContent = "No players online.";
        container.appendChild(span);
        return;
    }

    data.players.forEach(name => {
        const span = document.createElement("span");
        span.className = "pill";
        span.textContent = name;
        container.appendChild(span);
    });
}

async function refreshHealth() {
    const data = await requestJSON(`${baseURL()}/health`);

    $("health-output").textContent = JSON.stringify(data, null, 2);
    $("health-updated").textContent =
        `Updated ${new Date().toLocaleTimeString()}`;

    // Adapt this to the actual fields returned by your API.
    const status = data.status ?? data.health ?? data.state;

    $("health-status").textContent =
        status == null ? "Online" : String(status);
}

async function refreshLogs() {
    if (logsBusy || !connected) return;

    logsBusy = true;

    try {
        const data = await requestJSON(`${baseURL()}/logs?lines=5`);

        const lines = (data.lines || []).map(original => {
            let line = original.replace("[Server thread/INFO]: ", "");
            line = line.replace(/,/g, "");

            const timestampEnd = line.indexOf("]");
            if (timestampEnd !== -1) {
                line = line.slice(timestampEnd + 1).trim();
            }

            return `[Log] ${line}`;
        });

        $("output").textContent = lines.join("\n");
    } catch (error) {
        reportError("Log refresh failed", error);
    } finally {
        logsBusy = false;
    }
}

async function refreshLookup() {
    const name = $("lookup").value.trim();

    if (!name || lookupBusy || !connected) return;

    lookupBusy = true;

    const player = encodeURIComponent(name);
    const base = baseURL();

    try {
        const results = await Promise.allSettled([
            requestJSON(`${base}/stats/${player}`),
            requestJSON(`${base}/rank/${player}`),
            requestJSON(`${base}/balance/${player}`)
        ]);

        const [stats, rank, balance] = results;

        if (stats.status === "fulfilled") {
            const data = stats.value;
            $("user").textContent =
                `${displayValue(data.name)}`;
            $("kills").textContent =
                `${displayValue(data.kills)}`;
            $("deaths").textContent =
                `${displayValue(data.deaths)}`;
            $("uuid").textContent = displayValue(data.uuid);
        } else {
            reportError("Stats lookup failed", stats.reason);
        }

        if (rank.status === "fulfilled") {
            $("rank").textContent =
                `${displayValue(rank.value.rank)}`;
        } else {
            reportError("Rank lookup failed", rank.reason);
        }

        if (balance.status === "fulfilled") {
            $("balance").textContent =
                `${displayValue(balance.value.balance)}`;
        } else {
            reportError("Balance lookup failed", balance.reason);
        }
    } finally {
        lookupBusy = false;
    }
}

async function refreshEverything() {
    if (allBusy || !connected) return;

    allBusy = true;

    try {
        const results = await Promise.allSettled([
            refreshPlayers(),
            refreshHealth(),
            refreshLookup()
        ]);

        results.forEach((result, index) => {
            if (result.status === "rejected") {
                reportError(
                    ["Players refresh", "Health refresh", "Lookup refresh"][index],
                    result.reason
                );
            }
        });
    } finally {
        allBusy = false;
    }
}

function startAutoRefresh() {
    clearInterval(allTimer);
    clearInterval(logsTimer);

    allTimer = setInterval(refreshEverything, 10000);
    logsTimer = setInterval(refreshLogs, 5000);
}

$("submit").addEventListener("click", async () => {
    if (!getToken()) {
        alert("Please enter your token!");
        return;
    }

    $("submit").disabled = true;
    $("submit").textContent = "CONNECTING...";

    connected = true;
    setConnection(true);

    try {
        await refreshEverything();
        await refreshLogs();
        startAutoRefresh();
        $("submit").textContent = "REFRESH NOW";
    } catch (error) {
        connected = false;
        setConnection(false);
        clearInterval(allTimer);
        clearInterval(logsTimer);
        reportError("Connection failed", error);
        alert(`Connection failed: ${error.message}`);
        $("submit").textContent = "CONNECT";
    } finally {
        $("submit").disabled = false;
    }
});

// Manually refresh all data.
$("submit").textContent = "CONNECT";

// Manual log refresh.
$("refresh-logs").addEventListener("click", refreshLogs);

// Manual player lookup.
$("look").addEventListener("click", refreshLookup);

$("lookup").addEventListener("keydown", event => {
    if (event.key === "Enter") refreshLookup();
});

// Send a Minecraft command.
$("command").addEventListener("click", async () => {
    const command = $("input").value.trim();

    if (!getToken()) {
        alert("Please enter your token!");
        return;
    }

    if (!command) {
        alert("Please enter a command!");
        return;
    }

    if (commandBusy) return;

    commandBusy = true;
    $("command").disabled = true;
    $("command-result").textContent = "Sending command...";

    try {
        const response = await fetch(`${baseURL()}/command`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ command })
        });

        const result = await response.text();

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${result}`);
        }

        $("command-result").textContent =
            result || "Command request successful.";

        $("input").value = "";
    } catch (error) {
        $("command-result").textContent = `Error: ${error.message}`;
        reportError("Command failed", error);
    } finally {
        commandBusy = false;
        $("command").disabled = false;
    }
});

$("input").addEventListener("keydown", event => {
    if (event.key === "Enter") $("command").click();
});
