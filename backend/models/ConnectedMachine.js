const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const ConnectedMachine = sequelize.define('ConnectedMachine', {
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  deviceId:        { type: DataTypes.INTEGER, allowNull: false },
  name:            { type: DataTypes.STRING,  allowNull: false },
  host:            { type: DataTypes.STRING,  allowNull: false },
  sshPort:         { type: DataTypes.INTEGER, defaultValue: 22 },
  sshUser:         { type: DataTypes.STRING,  defaultValue: 'root' },
  sshAuthType:     { type: DataTypes.STRING,  defaultValue: 'password' }, // 'password' | 'key'
  sshPassword:     { type: DataTypes.STRING,  allowNull: true },
  sshKeyPath:      { type: DataTypes.STRING,  allowNull: true },
  sshKeyContent:   { type: DataTypes.TEXT,    allowNull: true },
  shutdownCommand: { type: DataTypes.STRING,  defaultValue: 'sudo shutdown -h now' },
  shutdownDelay:   { type: DataTypes.INTEGER, defaultValue: 0 }, // seconds after OB+LB before shutdown is sent
  description:     { type: DataTypes.STRING,  allowNull: true },
  active:          { type: DataTypes.BOOLEAN, defaultValue: true },
  lastAction:      { type: DataTypes.STRING,  allowNull: true },
  lastActionAt:    { type: DataTypes.DATE,    allowNull: true },
  nutMonitorDeployed: { type: DataTypes.BOOLEAN, defaultValue: false },
  nutMonitorStatus:   { type: DataTypes.STRING,  allowNull: true },
  sshHostKey:         { type: DataTypes.STRING,  allowNull: true }, // SHA256:… fingerprint, TOFU-pinned
})

module.exports = ConnectedMachine
