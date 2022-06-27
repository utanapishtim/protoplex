# Protoplex

Multiplex multiple streams over a stream. Bidirectional clients / servers.

`npm install protoplex`

## Usage
```js
import SecretStream from '@hyperswarm/secret-stream'
import Protomux from 'protomux'
import Protoplex from 'protoplex'
import { pipeline } from 'streamx'

const server = new Protoplex(new Protomux(new SecretStream(false)))
const client = new Protoplex(new Protomux(new SecretStream(true)))

pipeline(
  client.mux.stream.rawStream,
  server.mux.stream.rawStream,
  client.mux.stream.rawStream
)

// alternatively, const clientplex = Protoplex.from(new SecretStream(true))

const message = Buffer.from('Hello, World!')

server.on('connection', async (stream, id) => {
  let str = ''
  for await (const buf of stream) str += buf.toString()
  console.log(str) // prints 'Hello, World!'
})

let stream = client.connect()
stream.write(message)
stream.end()

// protoplex makes no distinction between clients and servers

client.on('connection', async (stream) => {
  let str = ''
  for await (const buf of stream) str += buf.toString()
  console.log(str) // prints 'Hello, World!'
})
stream = server.connect()
stream.write(message)
stream.end()
```

## API

#### `const plex = new Protoplex(mux, [options])`

Options include:

```js
{
  ctl: {
    id: Buffer, // the id to use for the ctl channel
    handshakeEncoding: compact encoding // handshake encoding for the ctl channel
    handshake: must satisfy options.ctl.handshakeEncoding // handshake value for opening ctl channel
  },
  chan: {
    handshakeEncoding: compact encoding, // handshake encoding for stream channels
    handshake: must satisfy options.chan.handshakeEncoding, // default handshake for stream channels
    encoding: compact encoding | (id, handshake) => compact encoding // value encoding for stream channel values
  }
}
```

#### `const plex = Protoplex.from(muxOrStream, [options])`

Options passed through to `new Protoplex(mux, [options])`.

#### `const duplex = plex.connect(id, [options])`

Options include:

```js
{
  handshake: value should satisfy plex.options.chan.handshakeEncoding
}
```

Alternatively, you can call `plex.connect([options])` and a random id will be generated.

#### `plex.on('connection', stream, id, handshake)`

Emitted when a remote connection is opened.

#### `plex.on('open')`

Emitted when the `Protoplex` instance is fully opened.

#### `plex.on('close')`

Emitted when all `Protoplex` instance is fully closed.

#### `plex.on('destroy', protocol, id)`

Emitted when an underlying `Protomux` channel is destroyed.

#### `await plex.close()`

Close the `Protoplex` instance and all open connections.
