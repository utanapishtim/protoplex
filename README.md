# Protoplex

Multiplexed streams over a protomux instance. Enables bi-directional clients and servers.

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

const message = Buffer.from('Hello, World!')

server.on('connection', async (stream) => {
  let str = ''
  for await (const buf of stream) str += buf.toString()
  console.log(str) // prints 'Hello, World!'
})

server.listen(Buffer.from('1'))

let stream = client.connect(Buffer.from('1'))
stream.write(message)
stream.end()

// protoplex makes no distinction between clients and servers

client.on('connection', async (stream) => {
  let str = ''
  for await (const buf of stream) str += buf.toString()
  console.log(str) // prints 'Hello, World!'
})

client.listen(Buffer.from('2'))
stream = server.connect(Buffer.from('2'))
stream.write(message)
stream.end()
```

## API

#### `const plex = new Protoplex(mux, [options])`

Options include:

```js
{
  id: b4a.from([]), // default id
  handshake: b4a.from([]), // default handshake value
  handshakeEncoding: c.raw, // default handshake encoding
  onhandshake: (handshake) => true, // default function to accept or reject connection
  encoding: c.raw, // default encoding for values in a stream
  unique: false, // whether the underlying protomux channels should allow multi opens for a given  protcol, id pair
  ...streamOptions // the rest of the options are default options for the underlying Duplex streams
}
```

#### `const plex = Protoplex.from(muxOrStream, [options])`

Options passed through to `new Protoplex(mux, [options])`.

#### `const stream = plex.connect(id, [options])`

Options are the same as for `Protoplex.from` but override those defaults for.

#### `stream.on('connect')`

Emitted when the stream is opened and the handshake was accepted.

#### `plex.on('connection', (stream) => {})`

Emitted when a remote connection is opened.

#### `for (const connection of plex)`

Iterate over all open connections.

#### `for await (const stream of plex)`

Iterate over all connections as they arrive.