const tokenize = (text = '') => {
  if (!text) return []
  const match = text.match(/\S+|\s+/g)
  return match ? match : []
}

const buildLcsMatrix = (a, b) => {
  const m = a.length
  const n = b.length
  const matrix = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1])
      }
    }
  }

  return matrix
}

export const diffWords = (original = '', edited = '') => {
  const a = tokenize(original)
  const b = tokenize(edited)

  const matrix = buildLcsMatrix(a, b)
  const result = []

  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'equal', value: a[i] })
      i += 1
      j += 1
    } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
      result.push({ type: 'delete', value: a[i] })
      i += 1
    } else {
      result.push({ type: 'insert', value: b[j] })
      j += 1
    }
  }

  while (i < a.length) {
    result.push({ type: 'delete', value: a[i] })
    i += 1
  }

  while (j < b.length) {
    result.push({ type: 'insert', value: b[j] })
    j += 1
  }

  if (!result.length) return []

  const merged = [result[0]]

  for (let index = 1; index < result.length; index += 1) {
    const current = result[index]
    const previous = merged[merged.length - 1]
    if (previous.type === current.type) {
      previous.value += current.value
    } else {
      merged.push({ ...current })
    }
  }

  return merged
}
