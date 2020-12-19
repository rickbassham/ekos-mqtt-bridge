# ekos-mqtt-bridge

A bridge between KStars Ekos and MQTT.

## Running

```bash
git clone https://github.com/rickbassham/ekos-mqtt-bridge.git
cd ekos-mqtt-bridge
docker build -t ekos-mqtt-bridge:latest .
docker run \
    -e MQTT_BROKER_URL=mqtt://host.docker.internal \
    -p 3000:3000 \
    -it ekos-mqtt-bridge:latest
```
