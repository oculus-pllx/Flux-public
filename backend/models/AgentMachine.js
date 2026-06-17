const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const VALID_STATES = [
  'offline', 'online', 'command-sent', 'command-received',
  'ha-freezing', 'shutting-down', 'unreachable', 'error',
  'update-available', 'updating', 'update-failed', 'pending',
]

const AgentMachine = sequelize.define('AgentMachine', {
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  machineKey:       { type: DataTypes.STRING, allowNull: true, unique: true },
  hostname:         { type: DataTypes.STRING, allowNull: false },
  role:             { type: DataTypes.ENUM('ups-host','controlled','pve-node','pbs','both'), defaultValue: 'controlled' },
  os:               { type: DataTypes.STRING, allowNull: true },
  agentVersion:     { type: DataTypes.STRING, allowNull: true },
  capabilities:     { type: DataTypes.JSON, defaultValue: [] },
  virtualization:   { type: DataTypes.STRING, allowNull: true },
  state:            { type: DataTypes.STRING, defaultValue: 'offline' },
  stateDetail:      { type: DataTypes.STRING, allowNull: true },
  lastSeen:         { type: DataTypes.DATE, allowNull: true },
  enrollmentToken:  { type: DataTypes.STRING, allowNull: true },
  enrollmentExpiry: { type: DataTypes.DATE, allowNull: true },
  pveConfig:        { type: DataTypes.JSON, allowNull: true },
  pbsConfig:        { type: DataTypes.JSON, allowNull: true },
  nutConfig:        { type: DataTypes.JSON, allowNull: true },
  clusterId:        { type: DataTypes.STRING, allowNull: true },
  clusterVotes:     { type: DataTypes.INTEGER, defaultValue: 1 },
  upsGroupId:       { type: DataTypes.INTEGER, allowNull: true },
  deviceGroupId:    { type: DataTypes.INTEGER, allowNull: true },
  upsOutlet:        { type: DataTypes.STRING(100), allowNull: true },
  upsOutletBatteryBacked: { type: DataTypes.BOOLEAN, allowNull: true },
  notes: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  installLog: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  shutdownOrder:    { type: DataTypes.INTEGER, defaultValue: 0 },
  shutdownDelay:    { type: DataTypes.INTEGER, defaultValue: 0 },
  shutdownTimeout:  { type: DataTypes.INTEGER, defaultValue: 120 },
  updatePolicy:     { type: DataTypes.ENUM('manual','auto','scheduled'), defaultValue: 'manual' },
  updateSchedule:   { type: DataTypes.STRING, allowNull: true },
  active:           { type: DataTypes.BOOLEAN, defaultValue: true },
})

AgentMachine.VALID_STATES = VALID_STATES

module.exports = AgentMachine
