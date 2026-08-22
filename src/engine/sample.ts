import { Table } from './types'
import { tableFromRows } from './dataframe'

// A deliberately messy dataset that showcases every cleaning tool.
export function sampleTable(): Table {
  const header = ['Name', 'Country', 'Signup Date', 'Phone', 'Plan', 'Revenue']
  const rows: (string | null)[][] = [
    ['  Ada Lovelace ', 'United States', '2024-01-15', '(415) 555-0100', 'Pro', '1200'],
    ['grace hopper', 'USA', '15/02/2024', '415-555-0142', 'pro', '1,200'],
    ['Alan Turing', 'U.S.A.', 'Mar 3, 2024', '+1 415 555 0199', 'Enterprise', '4800'],
    ['Katherine Johnson', 'United Kingdom', '2024-02-28', '020 7946 0958', 'PRO', '1200'],
    ['katherine johnson', 'UK', '28/02/2024', '02079460958', 'Pro', ''],
    ['Linus Torvalds', 'Finland', '2024/04/11', '', 'enterprise', '4800'],
    ['MARGARET HAMILTON', 'United States', '11 Apr 2024', '415.555.0170', 'Pro ', '1200'],
    ['Dennis Ritchie', 'usa', '', '+14155550111', 'Basic', '299'],
    ['Ada Lovelace', 'United States', '2024-01-15', '(415) 555-0100', 'Pro', '1200'],
    ['Barbara Liskov', 'United  States', '2024-05-06', '415 555 0123', 'basic', '299'],
    ['  Tim Berners-Lee', 'U.K.', '06/05/2024', '+44 20 7946 0000', 'Enterprise', '4,800'],
    ['Donald Knuth', 'United States', 'May 20, 2024', '', 'pro', '1200'],
    ['', 'Germany', '2024-06-01', '+49 30 123456', 'Basic', '299'],
    ['Edsger Dijkstra', 'netherlands', '01/06/2024', '+31 20 1234567', 'Pro', '1200'],
    ['john von neumann', 'United States', '2024-03-19', '(415) 555-0188', 'enterprise', '4800']
  ]
  return tableFromRows(header, rows)
}
