export const SMS_URL      = process.env.SMS_URL      || ''
export const SMS_USERNAME = process.env.SMS_USERNAME || ''
export const SMS_PWD      = process.env.SMS_PWD      || ''
export const SMS_FROM     = process.env.SMS_FROM     || ''
export const SMS_ENABLED  = Boolean(SMS_URL && SMS_USERNAME && SMS_FROM)
