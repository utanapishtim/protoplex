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

#### `const plex = new Protoplex(mux)`

#### `const plex = Protoplex.from(muxOrStream)`

#### `const duplex = plex.connect([id])`

#### `plex.on('connection', stream, id)`
