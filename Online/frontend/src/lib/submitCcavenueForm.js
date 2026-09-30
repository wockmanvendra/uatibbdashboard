// Builds and submits a real hidden form to CCAvenue's actionUrl — avoids
// document.write, which doesn't play well with an SPA that's already taken
// over the document.
export function submitCcavenueForm({ actionUrl, fields }) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = actionUrl

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
}
