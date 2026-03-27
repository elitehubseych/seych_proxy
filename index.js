const http = require('http');
const crypto = require('crypto');
const net = require('net');
const TelegramBot = require('node-telegram-bot-api');

const MTPROTO_PORT = process.env.MTPROTO_PORT || 3443;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DOMAIN = process.env.DOMAIN || 'youfast.mtpproxy.link';
const PING_PORT = process.env.PORT || 3000;
const SECRET = process.env.MTPROTO_SECRET || generateSecret();

function generateSecret() {
    return crypto.randomBytes(16).toString('hex');
}

function generateMTProtoLink() {
    const secretHex = SECRET;
    const domainEncoded = Buffer.from(DOMAIN).toString('hex');
    const fullSecret = `ee${secretHex}${domainEncoded}`;
    return `https://t.me/proxy?server=${DOMAIN}&port=${MTPROTO_PORT}&secret=${fullSecret}`;
}

const telegramServers = [
    { host: '149.154.175.50', port: 443 },
    { host: '149.154.160.240', port: 443 },
    { host: '149.154.167.117', port: 443 },
    { host: '149.154.167.118', port: 443 },
    { host: '149.154.167.40', port: 443 }
];

function getRandomServer() {
    return telegramServers[Math.floor(Math.random() * telegramServers.length)];
}

function createMTProtoSocket(clientSocket) {
    const tgServer = getRandomServer();
    const tgSocket = net.createConnection({ host: tgServer.host, port: tgServer.port });

    tgSocket.on('connect', () => {
        tgSocket.pipe(clientSocket);
        clientSocket.pipe(tgSocket);
    });

    tgSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => tgSocket.destroy());
    tgSocket.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => tgSocket.destroy());
}

const mtprotoServer = net.createServer((socket) => {
    socket.once('data', (data) => {
        if (data.length < 41) {
            socket.destroy();
            return;
        }
        if (data[0] !== 0xee) {
            socket.destroy();
            return;
        }
        const secretReceived = data.slice(1, 17).toString('hex');
        if (secretReceived !== SECRET) {
            socket.destroy();
            return;
        }
        createMTProtoSocket(socket);
    });
    socket.on('error', () => {});
});

mtprotoServer.listen(MTPROTO_PORT, '0.0.0.0', () => {
    console.log(`MTProto proxy on port ${MTPROTO_PORT}`);
    console.log(`Secret: ${SECRET}`);
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const proxyLink = generateMTProtoLink();
    
    const keyboard = {
        inline_keyboard: [[{ text: 'Подключить прокси', url: proxyLink }]]
    };
    
    const message = 'SeychProxy\nЭтот прокси от Seych.\nБыстрый MTProto прокси для Telegram.';
    
    bot.sendMessage(chatId, message, { reply_markup: keyboard });
});

const webhookPath = `/bot${TELEGRAM_BOT_TOKEN}`;
const webhookUrl = `https://${DOMAIN}${webhookPath}`;

const server = http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const update = JSON.parse(body);
                bot.processUpdate(update);
            } catch (e) {}
            res.writeHead(200);
            res.end();
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'alive',
            proxy: generateMTProtoLink(),
            timestamp: Date.now()
        }));
    }
});

server.listen(PING_PORT, '0.0.0.0', () => {
    console.log(`HTTP server on port ${PING_PORT}`);
    
    bot.setWebhook(webhookUrl).then(() => {
        console.log('Webhook set:', webhookUrl);
    }).catch(err => {
        console.error('Webhook error:', err.message);
    });
});

function selfPing() {
    http.get(`http://localhost:${PING_PORT}/`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => console.log('Self-ping:', new Date().toISOString()));
    }).on('error', () => {});
}

setInterval(selfPing, 5 * 60 * 1000);

function shutdown() {
    console.log('Shutting down');
    mtprotoServer.close();
    server.close();
    bot.deleteWebhook().then(() => process.exit(0)).catch(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('Proxy started, setting up webhook...');
