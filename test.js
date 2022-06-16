import { once, on } from 'events'
import SecretStream from '@hyperswarm/secret-stream'
import Protomux from 'protomux'
import Protoplex from './index.js'
import { pipeline } from 'streamx'
import test from 'brittle'
import { Duplex } from 'streamx'

test('(client -> server) it should send and recv messages', async (t) => {
  t.plan(3)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  server.on('connection', async (stream, id) => {
    t.ok(stream instanceof Duplex)
    t.ok(Buffer.isBuffer(id))
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  const stream = client.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('(client <- server) it should send and recv messages', async (t) => {
  t.plan(3)
  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  client.on('connection', async (stream, id) => {
    t.ok(stream instanceof Duplex)
    t.ok(Buffer.isBuffer(id))
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })
  const stream = server.connect()
  stream.write(Buffer.from(message))
  stream.end()
})

test('it should send and recv messages from many clients', async (t) => {
  const count = Math.floor(Math.random() * ((Math.floor(Math.random() * 10)) * 10))
  t.plan(count)

  const { plexers: { server, client } } = testenv()
  const message = 'Hello, World!'
  server.on('connection', async (stream, id) => {
    let str = ''
    for await (const buf of stream) str += buf.toString()
    t.is(str, message)
  })

  for (let i = 0; i < count; i++) {
    const stream = client.connect()
    stream.write(Buffer.from(message))
    stream.end()
  }
})

function testenv (onend = noop) {
  const streams = {
    server: new SecretStream(false),
    client: new SecretStream(true)
  }
  const muxers = {
    server: new Protomux(streams.server),
    client: new Protomux(streams.client)
  }
  const plexers = {
    server: new Protoplex(muxers.server),
    client: new Protoplex(muxers.client)
  }

  pipeline(
    plexers.server.mux.stream.rawStream,
    plexers.client.mux.stream.rawStream,
    plexers.server.mux.stream.rawStream,
    onend
  )

  return { streams, muxers, plexers }
}

function noop () {}
