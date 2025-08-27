// Test file to debug tRPC requests
export async function testRegistration() {
  const response = await fetch('http://localhost:3000/v1/auth.register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'testdirect@example.com',
      password: 'testpassword123',
      confirmPassword: 'testpassword123',
    }),
  });
  
  const result = await response.json();
  console.log('Direct fetch result:', result);
  return result;
}