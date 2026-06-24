const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const Device = sequelize.define('Device', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  host: { type: DataTypes.STRING, allowNull: false },
  port: { type: DataTypes.INTEGER, defaultValue: 3493 },
  upsName: { type: DataTypes.STRING, defaultValue: 'ups' },
  groupId: { type: DataTypes.INTEGER, allowNull: true },
  pollInterval: { type: DataTypes.INTEGER, defaultValue: 30 },
  nutUsername: { type: DataTypes.STRING, allowNull: true },
  nutPassword: { type: DataTypes.STRING, allowNull: true },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastSeen: { type: DataTypes.DATE, allowNull: true },
  lastStatus: { type: DataTypes.JSON, allowNull: true },
  nutHealth: { type: DataTypes.JSON, allowNull: true },
  shutdownActive: { type: DataTypes.BOOLEAN, defaultValue: false },
})

module.exports = Device
