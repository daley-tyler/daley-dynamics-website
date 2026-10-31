// Local integration fixture: accepts SMTP messages and discards their contents.
// Never configure a public instance of this listener.
import { createServer } from 'node:net';

const port = Number(process.env.MOCK_SMTP_PORT || 2525);
const responseDelayMs = Number(process.env.MOCK_SMTP_DELAY_MS || 0);
const server = createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 localhost mock SMTP ready\r\n');
  let buffer = '';
  let receivingData = false;

  socket.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/u, '');
      buffer = buffer.slice(end + 1);

      if (receivingData) {
        if (line === '.') {
          receivingData = false;
          console.info('Mock SMTP accepted one enquiry message.');
          setTimeout(() => socket.write('250 2.0.0 message accepted\r\n'), responseDelayMs);
        }
        continue;
      }

      const command = line.split(' ', 1)[0].toUpperCase();
      if (command === 'EHLO' || command === 'HELO') socket.write('250 localhost\r\n');
      else if (command === 'MAIL' || command === 'RCPT') socket.write('250 2.1.0 ok\r\n');
      else if (command === 'DATA') {
        receivingData = true;
        socket.write('354 end with <CRLF>.<CRLF>\r\n');
      } else if (command === 'QUIT') {
        socket.write('221 2.0.0 bye\r\n');
        socket.end();
      } else socket.write('500 unsupported command\r\n');
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.info(`Mock SMTP sink listening on 127.0.0.1:${server.address().port}`);
});
