import Protomux from 'protomux'
import test from 'brittle'
import c from 'compact-encoding'
import b4a from 'b4a'
import struct from 'compact-encoding-struct'
import FramedStream from 'framed-stream'
import duplexes from 'duplex-through'

import Protoplex from './index.js'

test('should connect', async (t) => {
  t.plan(2)
  const { plexers: { server, client } } = testenv()
  server.on('connection', (stream) => { t.ok(stream) })
  server.listen()
  const stream = client.connect()
  stream.on('connect', () => { t.ok(stream) })
})

test('should connect on a given id', async (t) => {
  t.plan(2)
  const { plexers: { server, client } } = testenv()
  server.on('connection', (stream) => { t.ok(stream) })
  server.listen(b4a.from('address'))
  const stream = client.connect(b4a.from('address'))
  stream.once('connect', () => { t.ok(true) })
})

test('should connect on a given id and not another', async (t) => {
  t.plan(2)
  const { plexers: { server, client } } = testenv()
  server.on('connection', (stream) => { t.ok(stream.id.toString() === 'address') })
  server.listen(b4a.from('address'))
  client.connect(b4a.from('address'))
  const stream = client.connect(b4a.from('not listening'))
  stream.on('close', () => t.ok(true))
})

test('should propogate close from "server"', async (t) => {
  t.plan(2)
  const { plexers: { server, client } } = testenv()
  server.on('connection', (stream) => {
    t.ok(stream)
    stream.destroy()
  })
  server.listen()
  const stream = client.connect()
  stream.on('close', () => t.ok(true))
})

test('should propogate close from "client"', async (t) => {
  t.plan(1)
  const { plexers: { server, client } } = testenv()
  server.on('connection', (stream) => {
    stream.on('close', () => t.ok(true))
  })
  server.listen(b4a.from('1'))
  const stream = client.connect(b4a.from('1'))
  stream.once('connect', () => stream.destroy())
})

test('should send from "client" to "server"', async (t) => {
  t.plan(1)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  server.on('connection', async (stream) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  server.listen()
  const stream = client.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('should send from "client" to "server" pre-connect', async (t) => {
  t.plan(1)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  server.on('connection', async (stream) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  server.listen()
  const stream = client.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('should send from "server" to "client"', async (t) => {
  t.plan(1)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'

  server.on('connection', (stream) => {
    stream.write(Buffer.from(message))
    stream.end()
  })

  server.listen()
  const stream = client.connect()

  let str = ''
  for await (const buf of stream) str += buf.toString()
  t.is(str, message)
})

test('it should send and recv messages from many clients', async (t) => {
  const count = Math.floor(Math.random() * ((Math.floor(Math.random() * 10)) * 10)) || 1
  t.plan(count)

  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'

  server.on('connection', async (stream, id) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  server.listen()

  for (let i = 0; i < count; i++) {
    const stream = client.connect()
    stream.write(Buffer.from(message))
    stream.end()
  }
})

test('it should support bidirectional servers & clients', async (t) => {
  const count = Math.floor(Math.random() * ((Math.floor(Math.random() * 10)) * 10)) || 2
  t.plan(count)

  const { plexers: { server, client } } = testenv()

  const message = 'Hello, World!'

  server.on('connection', async (stream) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })

  client.on('connection', async (stream) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })

  const id1 = Buffer.from('1')
  const id2 = Buffer.from('2')

  server.listen(id1)
  client.listen(id2)

  for (let i = 0; i < count; i++) {
    const mkstream = (i % 2 === 0) ? () => client.connect(id1) : () => server.connect(id2)
    const stream = mkstream()
    stream.write(Buffer.from(message))
    stream.end()
  }
})

test('it should support passing custom encodings', async (t) => {
  t.plan(1)

  const message = { greeting: 'Hello, World!' }
  const opts = { encoding: struct.compile({ greeting: c.string }) }

  const { plexers: { server, client } } = testenv({ opts })

  server.on('connection', async (stream) => {
    for await (const msg of stream) t.is(msg.greeting, message.greeting)
  })

  server.listen()
  const stream = client.connect()
  stream.write(message)
  stream.end()
})

function testenv ({ opts = {} } = {}) {
  const [a, b] = duplexes()

  const streams = {
    server: new FramedStream(a),
    client: new FramedStream(b)
  }

  const muxers = {
    server: new Protomux(streams.server),
    client: new Protomux(streams.client)
  }

  const [sopts, copts] = (Array.isArray(opts)) ? opts : [opts, opts]

  const plexers = {
    server: new Protoplex(muxers.server, sopts),
    client: new Protoplex(muxers.client, copts)
  }

  return { streams, muxers, plexers }
}
