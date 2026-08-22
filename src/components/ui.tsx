import React from 'react'

export function Button({
  children,
  variant = 'plain',
  active,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'plain' | 'primary' | 'solid'
  active?: boolean
}) {
  const cls = ['btn']
  if (variant === 'primary') cls.push('primary')
  if (variant === 'solid') cls.push('solid')
  if (active) cls.push('active')
  cls.push(className)
  return (
    <button className={cls.join(' ')} {...rest}>
      {children}
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Select({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      className="inp"
      style={mono ? { fontFamily: 'var(--mono)' } : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function Divider() {
  return <div style={{ height: 1, background: 'var(--hairline)', margin: '4px 0' }} />
}
