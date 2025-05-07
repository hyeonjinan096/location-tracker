import './style.css'

const API_BASE_URL = 'https://api.where-car.com:8080';
const HUB_API_URL = 'http://ts.where-car.com:8090';

interface LocationData {
  latitude: number;
  longitude: number;
  timestamp: number;
}

interface TokenRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  dFWVer: string;
}

interface CarLogRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  onTime?: string;
  offTime?: string;
  gcd: string;
  lat: string;
  lon: string;
  ang: string;
  spd: string;
  sum: string;
}

interface GpsLogInfo {
  sec: string;    // 발생 시간 초(00-59)
  gcd: string;    // GPS 상태 (A: 정상, V: 비정상, 0: 미장착)
  lat: string;    // 위도 (x1000000)
  lon: string;    // 경도 (x1000000)
  ang: string;    // 방향 (0-365)
  spd: string;    // 속도 (0-255 km/h)
  sum: string;    // 누적 주행 거리 (0-9999999 m)
  bat: string;    // 배터리 전압 (0-9999, 실제값 x10)
}

interface GpsLogRequest {
  mdn: string;
  tid: string;
  mid: string;
  pv: string;
  did: string;
  oTime: string;
  cCnt: string;
  cList: GpsLogInfo[];
}

const END_TIME = 60;

class LocationTracker {
  private locations: LocationData[] = [];
  private intervalId: number | null = null;
  private sendIntervalId: number | null = null;
  private statusElement: HTMLElement;
  private locationElement: HTMLElement;
  private countElement: HTMLElement;
  private startButton: HTMLButtonElement;
  private mdnInput: HTMLInputElement;
  private token: string | null = null;
  private startTime: string | null = null;
  private map: naver.maps.Map | null = null;
  private markers: naver.maps.Marker[] = [];
  private path: naver.maps.Polyline | null = null;

  constructor() {
    this.statusElement = document.getElementById('status') as HTMLElement;
    this.locationElement = document.getElementById('current-location') as HTMLElement;
    this.countElement = document.getElementById('collected-count') as HTMLElement;
    this.startButton = document.getElementById('startTracking') as HTMLButtonElement;
    this.mdnInput = document.getElementById('mdnInput') as HTMLInputElement;

    this.initializeMap();
    this.countElement.textContent = `Collected: 0/${END_TIME}`;
    this.mdnInput.addEventListener('input', () => this.validateMdn());
    this.startButton.addEventListener('click', () => this.toggleTracking());
  }

  private async initializeMap() {
    const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`;
    script.async = true;
    
    script.onload = () => {
      // 지도 초기화
      this.map = new naver.maps.Map('map', {
        center: new naver.maps.LatLng(37.5665, 126.9780), // 서울 시청 좌표
        zoom: 15
      });

      // 경로 선 초기화
      this.path = new naver.maps.Polyline({
        path: [],
        strokeColor: '#FF0000',
        strokeWeight: 3,
        strokeOpacity: 0.8,
        map: this.map
      });
    };

    document.head.appendChild(script);
  }

  private validateMdn() {
    const mdn = this.mdnInput.value.trim();
    const isValid = /^\d{3}$/.test(mdn); // 11자리 숫자인지 확인
    this.startButton.disabled = !isValid;
    return isValid;
  }

  private getMdn(): string {
    return this.mdnInput.value.trim();
  }

  private formatDate(date: Date, includeSeconds: boolean = false): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return includeSeconds 
      ? `${year}${month}${day}${hours}${minutes}${seconds}`
      : `${year}${month}${day}${hours}${minutes}`;
  }

  private async getToken(): Promise<string> {
    const tokenRequest: TokenRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      dFWVer: "1.0.0"
    };

    try {
      console.log('Sending token request:', tokenRequest);
      const response = await fetch(`${API_BASE_URL}/api/emulator/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tokenRequest),
      });

      const data = await response.json();
      console.log('Token Response:', { status: response.status, data });
      
      if (!response.ok) {
        throw new Error(`Failed to get token: ${response.status} ${response.statusText}`);
      }

      return data.token;
    } catch (error) {
      console.error('Error getting token:', error);
      throw error;
    }
  }

  private async sendCarOnLog(position: GeolocationPosition): Promise<void> {
    const now = new Date();
    this.startTime = this.formatDate(now, true);

    const request: CarLogRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      onTime: this.startTime,
      gcd: "A",
      lat: String(Math.round(position.coords.latitude * 1000000)),
      lon: String(Math.round(position.coords.longitude * 1000000)),
      ang: "0",
      spd: "0",
      sum: "0"
    };

    try {
      console.log('Sending car ON request:', request);
      const response = await fetch(`${HUB_API_URL}/api/on`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Token': this.token!
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      console.log('Car ON Response:', { status: response.status, data });
      
      if (!response.ok) {
        throw new Error(`Failed to send car ON log: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending car ON log:', error);
      throw error;
    }
  }

  private async sendCarOffLog(position: GeolocationPosition): Promise<void> {
    const request: CarLogRequest = {
      mdn: this.getMdn(),
      tid: "A001",
      mid: "6",
      pv: "5",
      did: "1",
      onTime: this.startTime!,
      offTime: this.formatDate(new Date(), true),
      gcd: "A",
      lat: String(Math.round(position.coords.latitude * 1000000)),
      lon: String(Math.round(position.coords.longitude * 1000000)),
      ang: "0",
      spd: "0",
      sum: "0"
    };

    try {
      const response = await fetch(`${HUB_API_URL}/api/off`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Token': this.token!
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      console.log('Car OFF Response:', { status: response.status, data });
    } catch (error) {
      console.error('Error sending car OFF log:', error);
    }
  }

  private async sendLocations() {
    this.statusElement.textContent = 'Status: Sending locations...';
    
    try {
      if (!this.token) {
        throw new Error('No token available');
      }

      const now = new Date();
      const gpsLogRequest: GpsLogRequest = {
        mdn: this.getMdn(),
        tid: "A001",
        mid: "6",
        pv: "5",
        did: "1",
        oTime: this.formatDate(now, false),  // yyyyMMddHHmm 형식
        cCnt: "60",  // 항상 60개
        cList: Array.from({ length: 60 }, (_, i) => {
          const sec = String(i).padStart(2, '0');  // 00부터 59까지
          const location = this.locations.find(loc => {
            const locDate = new Date(loc.timestamp);
            return String(locDate.getSeconds()).padStart(2, '0') === sec;
          }) || this.locations[this.locations.length - 1];  // 해당 초의 데이터가 없으면 마지막 위치 사용

          return {
            sec,
            gcd: "A",
            lat: String(Math.round(location.latitude * 1000000)),
            lon: String(Math.round(location.longitude * 1000000)),
            ang: "0",
            spd: "0",
            sum: "0",
            bat: "120"
          };
        })
      };

      console.log('Sending GPS log request:', gpsLogRequest);
      const response = await fetch(`${HUB_API_URL}/api/gps`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Token': this.token
        },
        body: JSON.stringify(gpsLogRequest),
      });

      if (!response.ok) {
        throw new Error('Failed to send locations');
      }

      const data = await response.json();
      console.log('GPS Log Response:', { status: response.status, data });

      this.locations = [];
      this.statusElement.textContent = 'Status: Locations sent successfully';
    } catch (error) {
      console.error('Error sending locations:', error);
      this.statusElement.textContent = 'Status: Error sending locations';
    }
  }

  private async getCurrentPosition(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
  }

  private async collectLocation() {
    try {
      const position = await this.getCurrentPosition();
      const locationData: LocationData = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: Date.now()
      };

      this.locations.push(locationData);
      this.updateUI(locationData);
    } catch (error) {
      console.error('Error getting location:', error);
      this.statusElement.textContent = 'Status: Error getting location';
    }
  }

  private updateMap(location: LocationData) {
    if (!this.map || !this.path) return;

    const position = new naver.maps.LatLng(location.latitude, location.longitude);
    
    // 마커 추가
    const marker = new naver.maps.Marker({
      position: position,
      map: this.map,
      title: new Date(location.timestamp).toLocaleTimeString()
    });
    this.markers.push(marker);

    // 경로 업데이트
    const path = this.path.getPath();
    path.push(position);
    this.path.setPath(path);

    // 지도 중심 이동
    this.map.setCenter(position);
  }

  private clearMap() {
    if (!this.map) return;

    // 마커 제거
    this.markers.forEach(marker => marker.setMap(null));
    this.markers = [];

    // 경로 제거
    if (this.path) {
      this.path.setMap(null);
      this.path = null;
    }

    // 새로운 경로 생성
    this.path = new naver.maps.Polyline({
      path: [],
      strokeColor: '#FF0000',
      strokeWeight: 3,
      strokeOpacity: 0.8,
      map: this.map
    });
  }

  private updateUI(location: LocationData) {
    this.locationElement.textContent = `Current Location: ${location.latitude}, ${location.longitude}`;
    this.countElement.textContent = `Collected: ${this.locations.length}/${END_TIME}`;
    this.updateMap(location);
  }

  private async toggleTracking() {
    if (this.intervalId === null) {
      // Start tracking
      if (!navigator.geolocation) {
        this.statusElement.textContent = 'Status: Geolocation is not supported';
        return;
      }

      if (!this.validateMdn()) {
        this.statusElement.textContent = 'Status: Invalid MDN';
        return;
      }

      try {
        this.statusElement.textContent = 'Status: Getting token...';
        console.log('Starting token request...');
        this.token = await this.getToken();
        console.log('Token received successfully');
        
        this.statusElement.textContent = 'Status: Token received, sending car ON log...';
        console.log('Starting car ON request...');
        const position = await this.getCurrentPosition();
        await this.sendCarOnLog(position);
        console.log('Car ON log sent successfully');
        
        this.statusElement.textContent = 'Status: Car ON log sent, starting tracking...';
        
        // Collect location every second
        this.intervalId = setInterval(() => this.collectLocation(), 1000);
        
        // Send collected locations every minute
        this.sendIntervalId = setInterval(async () => {
          if (this.locations.length > 0) {
            await this.sendLocations();
          }
        }, END_TIME * 100);
        
        this.startButton.textContent = 'Stop Tracking';
      } catch (error: any) {
        console.error('Error in toggleTracking:', error);
        this.statusElement.textContent = `Status: Failed to start tracking - ${error.message}`;
      }
    } else {
      // Stop tracking
      try {
        const position = await this.getCurrentPosition();
        await this.sendCarOffLog(position);
        
        if (this.intervalId !== null) clearInterval(this.intervalId);
        if (this.sendIntervalId !== null) clearInterval(this.sendIntervalId);
        this.intervalId = null;
        this.sendIntervalId = null;
        
        if (this.locations.length > 0) {
          await this.sendLocations();
        }
        
        // 완전한 초기화
        this.clearMap();
        this.locations = [];
        this.locationElement.textContent = 'Current Location: -';
        this.countElement.textContent = `Collected: 0/${END_TIME}`;
        this.statusElement.textContent = 'Status: Tracking stopped, car OFF log sent';
        this.startButton.textContent = 'Start Tracking';
      } catch (error) {
        console.error('Error stopping tracking:', error);
        this.statusElement.textContent = 'Status: Error sending car OFF log';
      }
    }
  }
}

// Initialize the tracker when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new LocationTracker();
});
