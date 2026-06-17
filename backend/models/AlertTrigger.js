const { DataTypes } = require('sequelize')
const { sequelize } = require('../config/database')

const AlertTrigger = sequelize.define('AlertTrigger', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  deviceId: { type: DataTypes.INTEGER, allowNull: true },
  groupId: { type: DataTypes.INTEGER, allowNull: true },
  variable: { type: DataTypes.STRING, allowNull: false },
  condition: {
    type: DataTypes.ENUM('gt', 'lt', 'eq', 'ne', 'gte', 'lte', 'contains', 'not_contains'),
    allowNull: false,
  },
  threshold: { type: DataTypes.STRING, allowNull: false },
  severity: { type: DataTypes.ENUM('info', 'warning', 'critical'), defaultValue: 'warning' },
  cooldown: { type: DataTypes.INTEGER, defaultValue: 300 },
  emailEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  fireOnce: { type: DataTypes.BOOLEAN, defaultValue: false },
  notifyOnRecovery: { type: DataTypes.BOOLEAN, defaultValue: false },
  active: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastTriggered: { type: DataTypes.DATE, allowNull: true },
})

module.exports = AlertTrigger
