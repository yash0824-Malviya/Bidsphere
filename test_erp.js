const res = await fetch('http://80.225.204.210:8090/api/resource/Business%20Case?limit_page_length=100&fields=[%22name%22,%22title%22]', {
  headers: {
    'Authorization': 'token d38c611ab48e170:9aac303194dc746'
  }
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
