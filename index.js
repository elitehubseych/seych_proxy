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
    
    tgSocket.on('error', (err) => {
        clientSocket.destroy();
    });
    
    clientSocket.on('error', (err) => {
        tgSocket.destroy();
    });
    
    tgSocket.on('close', () => {
        clientSocket.destroy();
    });
    
    clientSocket.on('close', () => {
        tgSocket.destroy();
    });
}

const mtprotoServer = net.createServer((socket) => {
    socket.once('data', (data) => {
        if (data.length < 41) {
            socket.destroy();
            return;
        }
        
        const protocolByte = data[0];
        if (protocolByte !== 0xee) {
            socket.destroy();
            return;
        }
        
        const secretReceived = data.slice(1, 17).toString('hex');
        if (secretReceived !== SECRET) {
            socket.destroy();
            return;
        }
        
        const dcId = data.readUInt16LE(17);
        
        createMTProtoSocket(socket);
    });
    
    socket.on('error', () => {});
});

mtprotoServer.listen(MTPROTO_PORT, () => {
    console.log(`MTProto proxy started on port ${MTPROTO_PORT}`);
    console.log(`Secret: ${SECRET}`);
});

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const proxyLink = generateMTProtoLink();
    
    const keyboard = {
        inline_keyboard: [
            [
                {
                    text: 'Подключить прокси',
                    url: proxyLink
                }
            ]
        ]
    };
    
    const message = `SeychProxy\nЭтот прокси от Seych.\nБыстрый и надежный MTProto прокси для Telegram.`;
    
    bot.sendMessage(chatId, message, {
        reply_markup: keyboard
    });
});

const pingServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'alive',
        proxy: generateMTProtoLink(),
        timestamp: Date.now()
    }));
});

pingServer.listen(PING_PORT, () => {
    console.log(`Ping server started on port ${PING_PORT}`);
});

function selfPing() {
    const url = `http://localhost:${PING_PORT}/`;
    http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('Self-ping:', new Date().toISOString());
        });
    }).on('error', (err) => {
        console.error('Self-ping error:', err.message);
    });
}

setInterval(selfPing, 5 * 60 * 1000);

console.log('Bot and proxy servers initialized');
